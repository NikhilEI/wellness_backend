const { ApiError } = require("../middleware/errorHandler");

// Resolves the calling exhibitor user's own exhibitor_event_profiles.id for
// the session's active event — the anchor id most exhibitor-scoped routes
// (cart, orders, passes, forms) key off instead of company_id directly.
async function resolveOwnProfileId(pool, req) {
  if (!req.user.companyId) throw new ApiError(404, "No company profile is associated with this account.");

  const [rows] = await pool.query(
    "SELECT id FROM exhibitor_event_profiles WHERE event_id = ? AND company_id = ? LIMIT 1",
    [req.user.eventId, req.user.companyId]
  );
  if (rows.length === 0) throw new ApiError(404, "No exhibitor profile found for the active event.");
  return rows[0].id;
}

module.exports = { resolveOwnProfileId };
