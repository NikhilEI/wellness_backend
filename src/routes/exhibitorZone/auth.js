const crypto = require("crypto");
const express = require("express");
const { z } = require("zod");
const pool = require("../../db/pool");
const { hashPassword, verifyPassword, needsRehash } = require("../../utils/argon");
const { hashToken, generateSecureToken } = require("../../utils/crypto");
const { COOKIE_NAME, cookieOptions, createSession, destroySession, destroyOtherSessions } = require("../../utils/session");
const { notifyAdmins } = require("../../utils/notify");
const { sendMail, escapeHtml } = require("../../lib/mailer");
const asyncHandler = require("../../middleware/asyncHandler");
const requireAuth = require("../../middleware/requireAuth");
const validate = require("../../middleware/validate");
const { ApiError } = require("../../middleware/errorHandler");
const {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  switchEventSchema
} = require("../../validators/auth");

const router = express.Router();

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const RESET_TOKEN_TTL_MINUTES = Number(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES) || 30;
const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || "http://localhost:3010";

// Precomputed once so a login attempt against a non-existent email still pays
// the same Argon2 verify cost as a real one, keeping response timing
// indistinguishable and preventing user enumeration by timing.
let dummyHashPromise = hashPassword("not-a-real-password-used-for-timing-only");

function toPublicUser(user, role, companyId, eventId) {
  return {
    id: user.id,
    uuid: user.uuid,
    email: user.email,
    firstName: user.first_name,
    lastName: user.last_name,
    role,
    companyId,
    eventId
  };
}

async function resolveDefaultEventId(userId) {
  const [recentGrant] = await pool.query(
    `SELECT event_id FROM user_event_roles WHERE user_id = ? AND is_active = 1 ORDER BY granted_at DESC LIMIT 1`,
    [userId]
  );
  if (recentGrant.length > 0) return recentGrant[0].event_id;

  const [latestPublished] = await pool.query(
    `SELECT id FROM events WHERE status = 'published' AND deleted_at IS NULL ORDER BY start_date DESC LIMIT 1`
  );
  return latestPublished.length > 0 ? latestPublished[0].id : null;
}

router.post(
  "/register",
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const body = req.body;

    const [existing] = await pool.query("SELECT id FROM users WHERE email = ? LIMIT 1", [body.email]);
    if (existing.length > 0) {
      throw new ApiError(409, "An account with this email already exists.");
    }

    const eventId = await resolveDefaultEventId(null);
    if (!eventId) {
      throw new ApiError(503, "Registration is not open right now — no published event is configured.");
    }

    const [exhibitorAdminRole] = await pool.query("SELECT id FROM roles WHERE name = 'exhibitor_admin' LIMIT 1");
    if (exhibitorAdminRole.length === 0) {
      throw new ApiError(500, "Server misconfiguration: exhibitor_admin role is missing.");
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const companyUuid = crypto.randomUUID();
      const [companyResult] = await connection.query(
        `INSERT INTO companies
          (uuid, legal_name, display_name, company_type, industry_type, website,
           address_line1, address_line2, city, state, postal_code, country, phone, email,
           is_verified, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NOW(), NOW())`,
        [
          companyUuid,
          body.companyLegalName,
          body.companyDisplayName,
          body.companyType,
          body.industryType || null,
          body.website || null,
          body.addressLine1,
          body.addressLine2 || null,
          body.city,
          body.state || null,
          body.postalCode || null,
          body.country,
          body.companyPhone,
          body.companyEmail
        ]
      );
      const companyId = companyResult.insertId;

      await connection.query(
        `INSERT INTO exhibitor_event_profiles
          (uuid, event_id, company_id, participation_type, profile_status, onboarding_step, created_at, updated_at)
         VALUES (?, ?, ?, 'standalone', 'pending', 0, NOW(), NOW())`,
        [crypto.randomUUID(), eventId, companyId]
      );

      const passwordHash = await hashPassword(body.password);
      const userUuid = crypto.randomUUID();
      const [userResult] = await connection.query(
        `INSERT INTO users
          (uuid, email, password_hash, first_name, last_name, phone, timezone, locale,
           login_attempts, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'Asia/Kolkata', 'en-IN', 0, 1, NOW(), NOW())`,
        [userUuid, body.email, passwordHash, body.firstName, body.lastName, body.phone || null]
      );
      const userId = userResult.insertId;

      await connection.query(
        `INSERT INTO user_event_roles (user_id, event_id, role_id, company_id, granted_at, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, NOW(), 1, NOW(), NOW())`,
        [userId, eventId, exhibitorAdminRole[0].id, companyId]
      );

      await connection.commit();

      notifyAdmins(pool, eventId, {
        title: "New exhibitor registration",
        message: `${body.companyDisplayName} registered and is awaiting approval.`,
        type: "info"
      }).catch((err) => console.error("Failed to notify admins of new registration:", err));

      sendMail({
        to: body.email,
        subject: "Registration received — Exhibitor Zone",
        text: `Thanks for registering ${body.companyDisplayName}. Your account is pending organiser approval — we'll email you once it's reviewed.`,
        html: `<p>Thanks for registering <strong>${escapeHtml(body.companyDisplayName)}</strong>.</p><p>Your account is pending organiser approval — we'll email you once it's reviewed.</p>`
      });

      res.status(201).json({ message: "Registration submitted. Your account is pending approval." });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  })
);

router.post(
  "/login",
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    const [userRows] = await pool.query("SELECT * FROM users WHERE email = ? AND deleted_at IS NULL LIMIT 1", [email]);
    const user = userRows[0];

    if (!user) {
      await verifyPassword(await dummyHashPromise, password).catch(() => false);
      throw new ApiError(401, "Invalid email or password.");
    }

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      throw new ApiError(423, "This account is temporarily locked due to repeated failed logins. Try again later.");
    }

    const passwordOk = await verifyPassword(user.password_hash, password).catch(() => false);

    if (!passwordOk) {
      const attempts = user.login_attempts + 1;
      if (attempts >= MAX_LOGIN_ATTEMPTS) {
        await pool.query("UPDATE users SET login_attempts = 0, locked_until = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?", [
          LOCKOUT_MINUTES,
          user.id
        ]);
        throw new ApiError(423, `Too many failed attempts. This account is locked for ${LOCKOUT_MINUTES} minutes.`);
      }
      await pool.query("UPDATE users SET login_attempts = ? WHERE id = ?", [attempts, user.id]);
      throw new ApiError(401, "Invalid email or password.");
    }

    if (!user.is_active) throw new ApiError(401, "This account has been disabled.");

    if (needsRehash(user.password_hash)) {
      hashPassword(password)
        .then((newHash) => pool.query("UPDATE users SET password_hash = ? WHERE id = ?", [newHash, user.id]))
        .catch((err) => console.error("Failed to rehash password:", err));
    }

    await pool.query(
      "UPDATE users SET login_attempts = 0, last_login_at = NOW(), last_login_ip = ? WHERE id = ?",
      [req.ip, user.id]
    );

    const eventId = await resolveDefaultEventId(user.id);
    const { token, expiresAt } = await createSession(pool, {
      userId: user.id,
      eventId,
      ipAddress: req.ip,
      userAgent: req.get("user-agent")
    });

    res.cookie(COOKIE_NAME, token, cookieOptions());
    res.json({ message: "Logged in.", expiresAt });
  })
);

router.post(
  "/logout",
  requireAuth,
  asyncHandler(async (req, res) => {
    await destroySession(pool, req.cookies[COOKIE_NAME]);
    res.clearCookie(COOKIE_NAME, { path: "/" });
    res.json({ message: "Logged out." });
  })
);

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query("SELECT * FROM users WHERE id = ? LIMIT 1", [req.user.id]);
    const user = rows[0];
    res.json({ user: toPublicUser(user, req.user.role, req.user.companyId, req.user.eventId) });
  })
);

const updateMeSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  phone: z.string().trim().max(30).optional()
});

router.patch(
  "/me",
  requireAuth,
  validate(updateMeSchema),
  asyncHandler(async (req, res) => {
    await pool.query("UPDATE users SET first_name = ?, last_name = ?, phone = ?, updated_at = NOW() WHERE id = ?", [
      req.body.firstName,
      req.body.lastName,
      req.body.phone || null,
      req.user.id
    ]);

    const [rows] = await pool.query("SELECT * FROM users WHERE id = ? LIMIT 1", [req.user.id]);
    res.json({ message: "Account updated.", user: toPublicUser(rows[0], req.user.role, req.user.companyId, req.user.eventId) });
  })
);

router.post(
  "/switch-event",
  requireAuth,
  validate(switchEventSchema),
  asyncHandler(async (req, res) => {
    const { eventId } = req.body;

    if (req.user.role !== "super_admin") {
      const [grant] = await pool.query(
        "SELECT id FROM user_event_roles WHERE user_id = ? AND event_id = ? AND is_active = 1 LIMIT 1",
        [req.user.id, eventId]
      );
      if (grant.length === 0) {
        throw new ApiError(403, "You do not have access to that event.");
      }
    }

    await pool.query("UPDATE sessions SET event_id = ? WHERE id = ?", [eventId, req.user.sessionId]);
    res.json({ message: "Active event switched.", eventId });
  })
);

router.post(
  "/password/forgot",
  validate(forgotPasswordSchema),
  asyncHandler(async (req, res) => {
    const { email } = req.body;

    // Always 200 — never reveal whether an account exists.
    res.json({ message: "If an account exists for that email, a reset link has been sent." });

    const [rows] = await pool.query("SELECT id, first_name FROM users WHERE email = ? AND deleted_at IS NULL LIMIT 1", [
      email
    ]);
    if (rows.length === 0) return;
    const user = rows[0];

    const token = generateSecureToken(32);
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);

    await pool.query(
      "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, ip_address, created_at) VALUES (?, ?, ?, ?, NOW())",
      [user.id, tokenHash, expiresAt, req.ip]
    );

    const resetLink = `${FRONTEND_BASE_URL}/exhibitor-zone/reset-password?token=${token}`;
    sendMail({
      to: email,
      subject: "Reset your Exhibitor Zone password",
      text: `Reset your password here (valid for ${RESET_TOKEN_TTL_MINUTES} minutes): ${resetLink}`,
      html: `<p>Reset your password here (valid for ${RESET_TOKEN_TTL_MINUTES} minutes):</p><p><a href="${resetLink}">${resetLink}</a></p>`
    });
  })
);

router.post(
  "/password/reset",
  validate(resetPasswordSchema),
  asyncHandler(async (req, res) => {
    const { token, password } = req.body;
    const tokenHash = hashToken(token);

    const [rows] = await pool.query(
      "SELECT * FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW() LIMIT 1",
      [tokenHash]
    );
    const resetToken = rows[0];
    if (!resetToken) throw new ApiError(400, "This reset link is invalid or has expired.");

    const passwordHash = await hashPassword(password);

    await pool.query("UPDATE users SET password_hash = ?, login_attempts = 0, locked_until = NULL WHERE id = ?", [
      passwordHash,
      resetToken.user_id
    ]);
    await pool.query("UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ?", [resetToken.id]);
    await destroyOtherSessions(pool, resetToken.user_id, null);

    res.json({ message: "Password reset. Please log in with your new password." });
  })
);

router.post(
  "/password/change",
  requireAuth,
  validate(changePasswordSchema),
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;

    const [rows] = await pool.query("SELECT password_hash FROM users WHERE id = ? LIMIT 1", [req.user.id]);
    const ok = await verifyPassword(rows[0].password_hash, currentPassword).catch(() => false);
    if (!ok) throw new ApiError(400, "Current password is incorrect.");

    const passwordHash = await hashPassword(newPassword);
    await pool.query("UPDATE users SET password_hash = ?, password_changed_at = NOW() WHERE id = ?", [
      passwordHash,
      req.user.id
    ]);

    await destroyOtherSessions(pool, req.user.id, req.cookies[COOKIE_NAME]);
    res.json({ message: "Password changed." });
  })
);

module.exports = router;
