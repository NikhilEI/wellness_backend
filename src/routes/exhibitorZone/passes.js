const crypto = require("crypto");
const express = require("express");
const QRCode = require("qrcode");
const pool = require("../../db/pool");
const asyncHandler = require("../../middleware/asyncHandler");
const requireAuth = require("../../middleware/requireAuth");
const requireRole = require("../../middleware/requireRole");
const requireEventContext = require("../../middleware/requireEventContext");
const requireCompanyAccess = require("../../middleware/requireCompanyAccess");
const validate = require("../../middleware/validate");
const { ApiError } = require("../../middleware/errorHandler");
const { resolveOwnProfileId } = require("../../utils/exhibitorProfile");
const { createAllocationSchema, issuePassSchema, voidPassSchema } = require("../../validators/pass");

const router = express.Router();

const ADMIN_ROLES = ["super_admin", "organiser"];
// Who may call POST /passes/issue — the doc's flagged bug was that this route
// had NO role guard at all; this is the fix (plus the ownership check below).
const ISSUE_ROLES = ["super_admin", "organiser", "exhibitor_admin"];

router.use(requireAuth, requireEventContext);

router.get(
  "/types",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      "SELECT * FROM pass_types WHERE event_id = ? AND is_active = 1 ORDER BY sort_order, name",
      [req.user.eventId]
    );
    res.json({ passTypes: rows });
  })
);

router.post(
  "/allocations",
  requireRole(...ADMIN_ROLES),
  validate(createAllocationSchema),
  asyncHandler(async (req, res) => {
    const { exhibitorProfileId, passTypeId, allocatedQty, notes } = req.body;

    const [passTypeRows] = await pool.query("SELECT * FROM pass_types WHERE id = ? AND event_id = ? LIMIT 1", [
      passTypeId,
      req.user.eventId
    ]);
    const passType = passTypeRows[0];
    if (!passType) throw new ApiError(404, "Pass type not found.");

    if (passType.total_quota !== null) {
      const [[{ used }]] = await pool.query(
        "SELECT COALESCE(SUM(allocated_qty), 0) AS used FROM pass_allocations WHERE pass_type_id = ?",
        [passTypeId]
      );
      if (Number(used) + allocatedQty > passType.total_quota) {
        throw new ApiError(409, `Only ${passType.total_quota - Number(used)} of this pass type remain in quota.`);
      }
    }

    const [result] = await pool.query(
      `INSERT INTO pass_allocations (event_id, exhibitor_profile_id, pass_type_id, allocated_qty, issued_qty, allocated_by, allocated_at, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, NOW(), ?, NOW(), NOW())`,
      [req.user.eventId, exhibitorProfileId, passTypeId, allocatedQty, req.user.id, notes || null]
    );

    res.status(201).json({ message: "Pass quota allocated.", allocationId: result.insertId });
  })
);

router.get(
  "/allocations",
  asyncHandler(async (req, res) => {
    let profileId = req.query.exhibitorProfileId ? Number(req.query.exhibitorProfileId) : null;
    if (!ADMIN_ROLES.includes(req.user.role)) {
      profileId = await resolveOwnProfileId(pool, req);
    }

    const params = [req.user.eventId];
    let filter = "";
    if (profileId) {
      filter = "AND pa.exhibitor_profile_id = ?";
      params.push(profileId);
    }

    const [rows] = await pool.query(
      `SELECT pa.*, pt.name AS pass_type_name, pt.code AS pass_type_code
       FROM pass_allocations pa
       JOIN pass_types pt ON pt.id = pa.pass_type_id
       WHERE pa.event_id = ? ${filter}
       ORDER BY pa.allocated_at DESC`,
      params
    );
    res.json({ allocations: rows });
  })
);

router.post(
  "/issue",
  requireRole(...ISSUE_ROLES),
  validate(issuePassSchema),
  asyncHandler(async (req, res) => {
    const b = req.body;

    const [allocationRows] = await pool.query("SELECT * FROM pass_allocations WHERE id = ? AND event_id = ? LIMIT 1", [
      b.allocationId,
      req.user.eventId
    ]);
    const allocation = allocationRows[0];
    if (!allocation) throw new ApiError(404, "Allocation not found.");

    // The doc's bug #3: verify the allocation actually belongs to the
    // caller's own company, not just that it's for the right event.
    if (!ADMIN_ROLES.includes(req.user.role)) {
      const ownProfileId = await resolveOwnProfileId(pool, req);
      if (Number(ownProfileId) !== Number(allocation.exhibitor_profile_id)) {
        throw new ApiError(403, "This allocation does not belong to your company.");
      }
    }

    if (allocation.issued_qty >= allocation.allocated_qty) {
      throw new ApiError(409, "This allocation's quota has already been fully issued.");
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const qrCode = crypto.randomUUID();
      const [result] = await connection.query(
        `INSERT INTO passes
          (uuid, qr_code, event_id, exhibitor_profile_id, pass_type_id, allocation_id,
           holder_first_name, holder_last_name, holder_email, holder_phone, holder_job_title,
           issued_to_user_id, status, issued_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued', NOW(), NOW(), NOW())`,
        [
          crypto.randomUUID(),
          qrCode,
          req.user.eventId,
          allocation.exhibitor_profile_id,
          allocation.pass_type_id,
          allocation.id,
          b.holderFirstName,
          b.holderLastName,
          b.holderEmail || null,
          b.holderPhone || null,
          b.holderJobTitle || null,
          req.user.id
        ]
      );

      await connection.query("UPDATE pass_allocations SET issued_qty = issued_qty + 1, updated_at = NOW() WHERE id = ?", [
        allocation.id
      ]);
      await connection.query("UPDATE pass_types SET issued_count = issued_count + 1 WHERE id = ?", [
        allocation.pass_type_id
      ]);

      await connection.commit();
      res.status(201).json({ message: "Pass issued.", passId: result.insertId, qrCode });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  })
);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    let profileId = req.query.exhibitorProfileId ? Number(req.query.exhibitorProfileId) : null;
    if (!ADMIN_ROLES.includes(req.user.role)) {
      profileId = await resolveOwnProfileId(pool, req);
    }

    const params = [req.user.eventId];
    let filter = "";
    if (profileId) {
      filter = "AND p.exhibitor_profile_id = ?";
      params.push(profileId);
    }

    const [rows] = await pool.query(
      `SELECT p.*, pt.name AS pass_type_name
       FROM passes p
       JOIN pass_types pt ON pt.id = p.pass_type_id
       WHERE p.event_id = ? ${filter}
       ORDER BY p.issued_at DESC`,
      params
    );
    res.json({ passes: rows });
  })
);

router.get(
  "/by-code/:qrCode",
  requireRole(...ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT p.*, pt.name AS pass_type_name, c.display_name AS company_name
       FROM passes p
       JOIN pass_types pt ON pt.id = p.pass_type_id
       JOIN exhibitor_event_profiles eep ON eep.id = p.exhibitor_profile_id
       JOIN companies c ON c.id = eep.company_id
       WHERE p.qr_code = ? AND p.event_id = ? LIMIT 1`,
      [req.params.qrCode, req.user.eventId]
    );
    if (rows.length === 0) throw new ApiError(404, "No pass found for this code.");
    res.json({ pass: rows[0] });
  })
);

router.get(
  "/:id",
  requireCompanyAccess(async (req) => {
    const [rows] = await pool.query("SELECT exhibitor_profile_id FROM passes WHERE id = ?", [req.params.id]);
    if (!rows[0]) return null;
    const [profile] = await pool.query("SELECT company_id FROM exhibitor_event_profiles WHERE id = ?", [
      rows[0].exhibitor_profile_id
    ]);
    return profile[0] ? profile[0].company_id : null;
  }),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT p.*, pt.name AS pass_type_name FROM passes p JOIN pass_types pt ON pt.id = p.pass_type_id
       WHERE p.id = ? AND p.event_id = ? LIMIT 1`,
      [req.params.id, req.user.eventId]
    );
    if (rows.length === 0) throw new ApiError(404, "Pass not found.");
    res.json({ pass: rows[0] });
  })
);

router.get(
  "/:id/qrcode.png",
  requireCompanyAccess(async (req) => {
    const [rows] = await pool.query("SELECT exhibitor_profile_id FROM passes WHERE id = ?", [req.params.id]);
    if (!rows[0]) return null;
    const [profile] = await pool.query("SELECT company_id FROM exhibitor_event_profiles WHERE id = ?", [
      rows[0].exhibitor_profile_id
    ]);
    return profile[0] ? profile[0].company_id : null;
  }),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query("SELECT qr_code FROM passes WHERE id = ? AND event_id = ? LIMIT 1", [
      req.params.id,
      req.user.eventId
    ]);
    if (rows.length === 0) throw new ApiError(404, "Pass not found.");

    const buffer = await QRCode.toBuffer(rows[0].qr_code, { type: "png", width: 320, margin: 1 });
    res.setHeader("Content-Type", "image/png");
    res.send(buffer);
  })
);

router.patch(
  "/:id/void",
  requireRole(...ADMIN_ROLES),
  validate(voidPassSchema),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query("SELECT * FROM passes WHERE id = ? AND event_id = ? LIMIT 1", [
      req.params.id,
      req.user.eventId
    ]);
    const pass = rows[0];
    if (!pass) throw new ApiError(404, "Pass not found.");
    if (pass.status === "voided") throw new ApiError(400, "This pass is already voided.");

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      await connection.query(
        "UPDATE passes SET status = 'voided', voided_at = NOW(), voided_by = ?, void_reason = ? WHERE id = ?",
        [req.user.id, req.body.voidReason || null, pass.id]
      );
      await connection.query("UPDATE pass_allocations SET issued_qty = GREATEST(0, issued_qty - 1), updated_at = NOW() WHERE id = ?", [
        pass.allocation_id
      ]);
      await connection.query("UPDATE pass_types SET issued_count = GREATEST(0, issued_count - 1) WHERE id = ?", [
        pass.pass_type_id
      ]);

      await connection.commit();
      res.json({ message: "Pass voided." });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  })
);

module.exports = router;
