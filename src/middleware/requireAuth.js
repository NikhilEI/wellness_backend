const pool = require("../db/pool");
const { hashToken } = require("../utils/crypto");
const { COOKIE_NAME } = require("../utils/session");
const { ApiError } = require("./errorHandler");
const asyncHandler = require("./asyncHandler");

// Implements the session-validation algorithm: cookie -> hashed lookup -> user
// checks -> RBAC resolution (global super_admin first, then event-scoped role,
// defaulting to exhibitor_staff/no-company if neither grant exists).
const requireAuth = asyncHandler(async (req, res, next) => {
  const token = req.cookies ? req.cookies[COOKIE_NAME] : null;
  if (!token) throw new ApiError(401, "Not authenticated.");

  const tokenHash = hashToken(token);
  const [sessionRows] = await pool.query("SELECT * FROM sessions WHERE token_hash = ? AND expires_at > NOW() LIMIT 1", [
    tokenHash
  ]);
  const session = sessionRows[0];
  if (!session) throw new ApiError(401, "Session expired or invalid.");

  const [userRows] = await pool.query("SELECT * FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1", [
    session.user_id
  ]);
  const user = userRows[0];
  if (!user || !user.is_active) throw new ApiError(401, "Account is inactive.");
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw new ApiError(401, "Account is temporarily locked.");
  }

  const [globalAdminRows] = await pool.query(
    `SELECT uer.company_id FROM user_event_roles uer
     JOIN roles r ON r.id = uer.role_id
     WHERE uer.user_id = ? AND r.name = 'super_admin' AND uer.is_active = 1
     LIMIT 1`,
    [user.id]
  );

  let role = "exhibitor_staff";
  let companyId = null;

  if (globalAdminRows.length > 0) {
    role = "super_admin";
    companyId = globalAdminRows[0].company_id;
  } else if (session.event_id) {
    const [roleRows] = await pool.query(
      `SELECT r.name AS role_name, uer.company_id FROM user_event_roles uer
       JOIN roles r ON r.id = uer.role_id
       WHERE uer.user_id = ? AND uer.event_id = ? AND uer.is_active = 1
       LIMIT 1`,
      [user.id, session.event_id]
    );
    if (roleRows.length > 0) {
      role = roleRows[0].role_name;
      companyId = roleRows[0].company_id;
    }
  }

  pool.query("UPDATE sessions SET last_activity = NOW() WHERE id = ?", [session.id]).catch((err) => {
    console.error("Failed to bump session last_activity:", err);
  });

  req.user = {
    id: user.id,
    uuid: user.uuid,
    email: user.email,
    firstName: user.first_name,
    lastName: user.last_name,
    role,
    eventId: session.event_id,
    companyId,
    sessionId: session.id
  };

  next();
});

module.exports = requireAuth;
