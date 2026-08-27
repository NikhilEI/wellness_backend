const crypto = require("crypto");
const express = require("express");
const pool = require("../../../db/pool");
const asyncHandler = require("../../../middleware/asyncHandler");
const requireAuth = require("../../../middleware/requireAuth");
const requireRole = require("../../../middleware/requireRole");
const requireEventContext = require("../../../middleware/requireEventContext");
const { ApiError } = require("../../../middleware/errorHandler");
const { hashPassword } = require("../../../utils/argon");
const { generateSecureToken, hashToken } = require("../../../utils/crypto");
const { notifyAdmins } = require("../../../utils/notify");
const { sendMail, escapeHtml } = require("../../../lib/mailer");

const router = express.Router();

const ADMIN_ROLES = ["super_admin", "organiser"];
const DEFAULT_PASS_TYPE_CODE = "EXH_STAFF";
const RESET_TOKEN_TTL_MINUTES = Number(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES) || 30;
const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || "http://localhost:3010";

router.use(requireAuth, requireEventContext, requireRole(...ADMIN_ROLES));

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT sb.*, c.display_name AS company_name, eep.profile_status
       FROM space_bookings sb
       LEFT JOIN exhibitor_event_profiles eep ON eep.id = sb.exhibitor_profile_id
       LEFT JOIN companies c ON c.id = eep.company_id
       ORDER BY sb.created_at DESC`
    );
    res.json({ registrations: rows });
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT sb.*, c.display_name AS company_name, eep.profile_status
       FROM space_bookings sb
       LEFT JOIN exhibitor_event_profiles eep ON eep.id = sb.exhibitor_profile_id
       LEFT JOIN companies c ON c.id = eep.company_id
       WHERE sb.id = ? LIMIT 1`,
      [req.params.id]
    );
    if (rows.length === 0) throw new ApiError(404, "Registration not found.");
    res.json({ registration: rows[0] });
  })
);

router.post(
  "/:id/convert",
  asyncHandler(async (req, res) => {
    const [bookingRows] = await pool.query("SELECT * FROM space_bookings WHERE id = ? LIMIT 1", [req.params.id]);
    const booking = bookingRows[0];
    if (!booking) throw new ApiError(404, "Registration not found.");
    if (booking.converted_at) throw new ApiError(409, "This registration has already been converted.");

    const [passTypeRows] = await pool.query(
      "SELECT * FROM pass_types WHERE event_id = ? AND code = ? LIMIT 1",
      [req.user.eventId, DEFAULT_PASS_TYPE_CODE]
    );
    const passType = passTypeRows[0];
    if (!passType) throw new ApiError(500, "Default pass type is not configured for this event.");

    const connection = await pool.getConnection();
    let resetToken = null;
    let isNewUser = false;
    try {
      await connection.beginTransaction();

      let userId;
      let companyId;

      const [existingUserRows] = await connection.query("SELECT id FROM users WHERE email = ? LIMIT 1", [booking.email]);

      if (existingUserRows.length > 0) {
        userId = existingUserRows[0].id;
        const [existingRoleRows] = await connection.query(
          "SELECT company_id FROM user_event_roles WHERE user_id = ? AND event_id = ? LIMIT 1",
          [userId, req.user.eventId]
        );
        if (existingRoleRows.length > 0 && existingRoleRows[0].company_id) {
          companyId = existingRoleRows[0].company_id;
        }
      }

      if (!companyId) {
        const [companyResult] = await connection.query(
          `INSERT INTO companies
            (uuid, legal_name, display_name, city, country, phone, email, is_verified, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, NOW(), NOW())`,
          [
            crypto.randomUUID(),
            booking.organisation,
            booking.organisation,
            booking.city,
            booking.country,
            booking.mobile_no,
            booking.email,
            req.user.id
          ]
        );
        companyId = companyResult.insertId;
      }

      if (!userId) {
        isNewUser = true;
        const passwordHash = await hashPassword(generateSecureToken(24));
        const [userResult] = await connection.query(
          `INSERT INTO users
            (uuid, email, password_hash, first_name, last_name, phone, timezone, locale,
             login_attempts, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'Asia/Kolkata', 'en-IN', 0, 1, NOW(), NOW())`,
          [crypto.randomUUID(), booking.email, passwordHash, booking.first_name, booking.last_name, booking.mobile_no]
        );
        userId = userResult.insertId;
      }

      const [roleRows] = await connection.query("SELECT id FROM roles WHERE name = 'exhibitor_admin' LIMIT 1");
      if (roleRows.length === 0) throw new ApiError(500, "Server misconfiguration: exhibitor_admin role is missing.");

      const [existingGrant] = await connection.query(
        "SELECT id FROM user_event_roles WHERE user_id = ? AND event_id = ? LIMIT 1",
        [userId, req.user.eventId]
      );
      if (existingGrant.length === 0) {
        await connection.query(
          `INSERT INTO user_event_roles (user_id, event_id, role_id, company_id, granted_at, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, NOW(), 1, NOW(), NOW())`,
          [userId, req.user.eventId, roleRows[0].id, companyId]
        );
      }

      let profileId;
      const [existingProfileRows] = await connection.query(
        "SELECT id FROM exhibitor_event_profiles WHERE event_id = ? AND company_id = ? LIMIT 1",
        [req.user.eventId, companyId]
      );
      if (existingProfileRows.length > 0) {
        profileId = existingProfileRows[0].id;
      } else {
        const [profileResult] = await connection.query(
          `INSERT INTO exhibitor_event_profiles
            (uuid, event_id, company_id, participation_type, profile_status, onboarding_step, created_at, updated_at)
           VALUES (?, ?, ?, 'standalone', 'pending', 0, NOW(), NOW())`,
          [crypto.randomUUID(), req.user.eventId, companyId]
        );
        profileId = profileResult.insertId;
      }

      const [allocationResult] = await connection.query(
        `INSERT INTO pass_allocations (event_id, exhibitor_profile_id, pass_type_id, allocated_qty, issued_qty, allocated_by, allocated_at, notes, created_at, updated_at)
         VALUES (?, ?, ?, 1, 0, ?, NOW(), 'Default pass — auto-assigned on space booking conversion.', NOW(), NOW())`,
        [req.user.eventId, profileId, passType.id, req.user.id]
      );
      const allocationId = allocationResult.insertId;

      const qrCode = crypto.randomUUID();
      await connection.query(
        `INSERT INTO passes
          (uuid, qr_code, event_id, exhibitor_profile_id, pass_type_id, allocation_id,
           holder_first_name, holder_last_name, holder_email, holder_phone,
           issued_to_user_id, status, issued_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued', NOW(), NOW(), NOW())`,
        [
          crypto.randomUUID(),
          qrCode,
          req.user.eventId,
          profileId,
          passType.id,
          allocationId,
          booking.first_name,
          booking.last_name,
          booking.email,
          booking.mobile_no,
          req.user.id
        ]
      );
      await connection.query("UPDATE pass_allocations SET issued_qty = 1, updated_at = NOW() WHERE id = ?", [allocationId]);
      await connection.query("UPDATE pass_types SET issued_count = issued_count + 1 WHERE id = ?", [passType.id]);

      if (isNewUser) {
        resetToken = generateSecureToken(32);
        const tokenHash = hashToken(resetToken);
        const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);
        await connection.query(
          "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, ip_address, created_at) VALUES (?, ?, ?, ?, NOW())",
          [userId, tokenHash, expiresAt, req.ip]
        );
      }

      await connection.query(
        "UPDATE space_bookings SET exhibitor_profile_id = ?, converted_at = NOW(), converted_by = ? WHERE id = ?",
        [profileId, req.user.id, booking.id]
      );

      await connection.query(
        "INSERT INTO audit_logs (event_id, user_id, action, entity_type, entity_id, new_value, created_at) VALUES (?, ?, 'registration.converted', 'space_booking', ?, ?, NOW())",
        [req.user.eventId, req.user.id, booking.id, JSON.stringify({ profileId, companyId, userId, passTypeId: passType.id })]
      );

      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }

    if (isNewUser && resetToken) {
      const setPasswordLink = `${FRONTEND_BASE_URL}/exhibitor-zone/reset-password?token=${resetToken}`;
      sendMail({
        to: booking.email,
        subject: "You're in! Set your password — Exhibitor Zone",
        text:
          `Hi ${booking.first_name}, your Exhibitor Zone account for ${booking.organisation} is ready, and a default Exhibitor Staff pass has already been assigned to you.\n\n` +
          `Set your password here (valid for ${RESET_TOKEN_TTL_MINUTES} minutes) to log in and continue: ${setPasswordLink}`,
        html:
          `<p>Hi ${escapeHtml(booking.first_name)}, your Exhibitor Zone account for <strong>${escapeHtml(booking.organisation)}</strong> is ready, ` +
          `and a default Exhibitor Staff pass has already been assigned to you.</p>` +
          `<p>Set your password here (valid for ${RESET_TOKEN_TTL_MINUTES} minutes) to log in and continue:</p>` +
          `<p><a href="${setPasswordLink}">${setPasswordLink}</a></p>`
      });
    }

    notifyAdmins(pool, req.user.eventId, {
      title: "Space booking converted to exhibitor",
      message: `${booking.organisation} (${booking.email}) was converted to an exhibitor account.`,
      type: "success"
    }).catch((err) => console.error("Failed to notify admins of registration conversion:", err));

    res.json({ message: "Converted to exhibitor." });
  })
);

module.exports = router;
