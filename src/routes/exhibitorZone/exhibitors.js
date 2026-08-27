const crypto = require("crypto");
const express = require("express");
const pool = require("../../db/pool");
const asyncHandler = require("../../middleware/asyncHandler");
const requireAuth = require("../../middleware/requireAuth");
const requireRole = require("../../middleware/requireRole");
const requireEventContext = require("../../middleware/requireEventContext");
const requireCompanyAccess = require("../../middleware/requireCompanyAccess");
const validate = require("../../middleware/validate");
const { ApiError } = require("../../middleware/errorHandler");
const { decryptNullable } = require("../../utils/crypto");
const { notifyUser } = require("../../utils/notify");
const { sendMail, escapeHtml } = require("../../lib/mailer");
const {
  createCompanySchema,
  updateCompanySchema,
  createProfileSchema,
  updateProfileStatusSchema
} = require("../../validators/company");

const router = express.Router();

const ADMIN_ROLES = ["super_admin", "organiser", "finance"];

router.use(requireAuth, requireEventContext);

function decorateCompany(row) {
  return {
    ...row,
    gst_number: decryptNullable(row.gst_number_enc),
    pan_number: decryptNullable(row.pan_number_enc),
    gst_number_enc: undefined,
    pan_number_enc: undefined
  };
}

router.get(
  "/",
  requireRole(...ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const status = req.query.status;
    const params = [req.user.eventId];
    let statusFilter = "";
    if (status) {
      statusFilter = "AND eep.profile_status = ?";
      params.push(status);
    }

    const [rows] = await pool.query(
      `SELECT eep.*, c.legal_name, c.display_name, c.email AS company_email, c.phone AS company_phone, c.is_verified
       FROM exhibitor_event_profiles eep
       JOIN companies c ON c.id = eep.company_id
       WHERE eep.event_id = ? ${statusFilter}
       ORDER BY eep.created_at DESC`,
      params
    );

    res.json({ profiles: rows });
  })
);

router.get(
  "/my-profile",
  asyncHandler(async (req, res) => {
    if (!req.user.companyId) throw new ApiError(404, "No company profile is associated with this account.");

    const [rows] = await pool.query(
      `SELECT eep.*, c.*
       FROM exhibitor_event_profiles eep
       JOIN companies c ON c.id = eep.company_id
       WHERE eep.event_id = ? AND eep.company_id = ?
       LIMIT 1`,
      [req.user.eventId, req.user.companyId]
    );
    if (rows.length === 0) throw new ApiError(404, "No profile found for the active event.");

    res.json({ profile: decorateCompany(rows[0]) });
  })
);

router.patch(
  "/my-profile",
  validate(updateCompanySchema),
  asyncHandler(async (req, res) => {
    if (req.user.role === "exhibitor_staff") throw new ApiError(403, "Staff accounts cannot edit the company profile.");
    if (!req.user.companyId) throw new ApiError(404, "No company profile is associated with this account.");

    const fields = req.body;
    const columnMap = {
      legalName: "legal_name",
      displayName: "display_name",
      companyType: "company_type",
      industryType: "industry_type",
      website: "website",
      addressLine1: "address_line1",
      addressLine2: "address_line2",
      city: "city",
      state: "state",
      postalCode: "postal_code",
      country: "country",
      phone: "phone",
      email: "email"
    };

    const sets = [];
    const values = [];
    for (const [key, column] of Object.entries(columnMap)) {
      if (fields[key] !== undefined) {
        sets.push(`${column} = ?`);
        values.push(fields[key]);
      }
    }
    if (sets.length === 0) throw new ApiError(400, "No fields to update.");

    values.push(req.user.companyId);
    await pool.query(`UPDATE companies SET ${sets.join(", ")}, updated_at = NOW() WHERE id = ?`, values);

    res.json({ message: "Company profile updated." });
  })
);

router.patch(
  "/companies/:companyId",
  requireRole("super_admin", "organiser"),
  validate(updateCompanySchema),
  asyncHandler(async (req, res) => {
    const fields = req.body;
    const columnMap = {
      legalName: "legal_name",
      displayName: "display_name",
      companyType: "company_type",
      industryType: "industry_type",
      website: "website",
      addressLine1: "address_line1",
      addressLine2: "address_line2",
      city: "city",
      state: "state",
      postalCode: "postal_code",
      country: "country",
      phone: "phone",
      email: "email"
    };

    const sets = [];
    const values = [];
    for (const [key, column] of Object.entries(columnMap)) {
      if (fields[key] !== undefined) {
        sets.push(`${column} = ?`);
        values.push(fields[key]);
      }
    }
    if (sets.length === 0) throw new ApiError(400, "No fields to update.");

    values.push(req.params.companyId);
    const [result] = await pool.query(`UPDATE companies SET ${sets.join(", ")}, updated_at = NOW() WHERE id = ?`, values);
    if (result.affectedRows === 0) throw new ApiError(404, "Company not found.");

    res.json({ message: "Company updated." });
  })
);

router.get(
  "/:profileId",
  requireCompanyAccess(async (req) => {
    const [rows] = await pool.query("SELECT company_id FROM exhibitor_event_profiles WHERE id = ? LIMIT 1", [
      req.params.profileId
    ]);
    return rows[0] ? rows[0].company_id : null;
  }),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT eep.*, c.*
       FROM exhibitor_event_profiles eep
       JOIN companies c ON c.id = eep.company_id
       WHERE eep.id = ?
       LIMIT 1`,
      [req.params.profileId]
    );
    if (rows.length === 0) throw new ApiError(404, "Profile not found.");
    res.json({ profile: decorateCompany(rows[0]) });
  })
);

router.post(
  "/companies",
  requireRole("super_admin", "organiser"),
  validate(createCompanySchema),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const [result] = await pool.query(
      `INSERT INTO companies
        (uuid, legal_name, display_name, company_type, industry_type, website,
         address_line1, address_line2, city, state, postal_code, country, phone, email,
         is_verified, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NOW(), NOW())`,
      [
        crypto.randomUUID(),
        b.legalName,
        b.displayName,
        b.companyType || null,
        b.industryType || null,
        b.website || null,
        b.addressLine1,
        b.addressLine2 || null,
        b.city,
        b.state || null,
        b.postalCode || null,
        b.country,
        b.phone || null,
        b.email || null,
        req.user.id
      ]
    );

    res.status(201).json({ message: "Company created.", companyId: result.insertId });
  })
);

router.post(
  "/profiles",
  requireRole("super_admin", "organiser"),
  validate(createProfileSchema),
  asyncHandler(async (req, res) => {
    const b = req.body;

    const [existing] = await pool.query(
      "SELECT id FROM exhibitor_event_profiles WHERE event_id = ? AND company_id = ? LIMIT 1",
      [b.eventId, b.companyId]
    );
    if (existing.length > 0) throw new ApiError(409, "This company already has a profile for that event.");

    const [result] = await pool.query(
      `INSERT INTO exhibitor_event_profiles
        (uuid, event_id, company_id, participation_type, category, sub_category, fascia_name,
         profile_status, approved_at, approved_by, onboarding_step, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', NOW(), ?, 0, NOW(), NOW())`,
      [
        crypto.randomUUID(),
        b.eventId,
        b.companyId,
        b.participationType || "standalone",
        b.category || null,
        b.subCategory || null,
        b.fasciaName || null,
        req.user.id
      ]
    );

    res.status(201).json({ message: "Exhibitor profile created and approved.", profileId: result.insertId });
  })
);

router.patch(
  "/profiles/:profileId/status",
  requireRole("super_admin", "organiser"),
  validate(updateProfileStatusSchema),
  asyncHandler(async (req, res) => {
    const { status, rejectionReason } = req.body;

    const [rows] = await pool.query(
      "SELECT eep.*, c.display_name, c.email AS company_email FROM exhibitor_event_profiles eep JOIN companies c ON c.id = eep.company_id WHERE eep.id = ? LIMIT 1",
      [req.params.profileId]
    );
    const profile = rows[0];
    if (!profile) throw new ApiError(404, "Profile not found.");

    await pool.query(
      `UPDATE exhibitor_event_profiles
       SET profile_status = ?, approved_at = ?, approved_by = ?, rejection_reason = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        status,
        status === "approved" ? new Date() : null,
        status === "approved" ? req.user.id : null,
        status === "rejected" ? rejectionReason || null : null,
        req.params.profileId
      ]
    );

    const [companyUsers] = await pool.query(
      "SELECT DISTINCT user_id FROM user_event_roles WHERE company_id = ? AND event_id = ?",
      [profile.company_id, profile.event_id]
    );

    const statusMessage = {
      approved: `${profile.display_name}'s exhibitor profile has been approved.`,
      rejected: `${profile.display_name}'s exhibitor profile was rejected.${rejectionReason ? ` Reason: ${rejectionReason}` : ""}`,
      suspended: `${profile.display_name}'s exhibitor profile has been suspended.`,
      pending: `${profile.display_name}'s exhibitor profile is pending review.`
    }[status];

    await Promise.all(
      companyUsers.map((u) =>
        notifyUser(pool, {
          userId: u.user_id,
          title: "Exhibitor profile status updated",
          message: statusMessage,
          type: status === "approved" ? "success" : status === "rejected" ? "error" : "warning"
        })
      )
    );

    if (profile.company_email) {
      sendMail({
        to: profile.company_email,
        subject: `Exhibitor profile ${status} — Exhibitor Zone`,
        text: statusMessage,
        html: `<p>${escapeHtml(statusMessage)}</p>`
      });
    }

    res.json({ message: "Profile status updated." });
  })
);

module.exports = router;
