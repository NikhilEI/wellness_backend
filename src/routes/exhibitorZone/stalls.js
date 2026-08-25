const express = require("express");
const pool = require("../../db/pool");
const asyncHandler = require("../../middleware/asyncHandler");
const requireAuth = require("../../middleware/requireAuth");
const requireRole = require("../../middleware/requireRole");
const requireEventContext = require("../../middleware/requireEventContext");
const validate = require("../../middleware/validate");
const { ApiError } = require("../../middleware/errorHandler");
const { createStallSchema, updateStallSchema, createAllocationSchema } = require("../../validators/stall");

const router = express.Router();

const ADMIN_ROLES = ["super_admin", "organiser"];

router.use(requireAuth, requireEventContext);

router.get(
  "/",
  requireRole(...ADMIN_ROLES, "finance"),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT s.*, sa.id AS allocation_id, sa.exhibitor_profile_id, c.display_name AS allocated_to
       FROM stalls s
       LEFT JOIN stall_allocations sa ON sa.stall_id = s.id AND sa.released_at IS NULL
       LEFT JOIN exhibitor_event_profiles eep ON eep.id = sa.exhibitor_profile_id
       LEFT JOIN companies c ON c.id = eep.company_id
       WHERE s.event_id = ?
       ORDER BY s.stall_number`,
      [req.user.eventId]
    );
    res.json({ stalls: rows });
  })
);

router.post(
  "/",
  requireRole(...ADMIN_ROLES),
  validate(createStallSchema),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const [existing] = await pool.query("SELECT id FROM stalls WHERE event_id = ? AND stall_number = ? LIMIT 1", [
      req.user.eventId,
      b.stallNumber
    ]);
    if (existing.length > 0) throw new ApiError(409, "A stall with this number already exists for this event.");

    const [result] = await pool.query(
      `INSERT INTO stalls (event_id, stall_number, hall, block, stall_type, area_sqm, price_inr, price_usd, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'available', NOW(), NOW())`,
      [req.user.eventId, b.stallNumber, b.hall || null, b.block || null, b.stallType || null, b.areaSqm || null, b.priceInr || null, b.priceUsd || null]
    );

    res.status(201).json({ message: "Stall created.", stallId: result.insertId });
  })
);

router.patch(
  "/:id",
  requireRole(...ADMIN_ROLES),
  validate(updateStallSchema),
  asyncHandler(async (req, res) => {
    const columnMap = {
      stallNumber: "stall_number",
      hall: "hall",
      block: "block",
      stallType: "stall_type",
      areaSqm: "area_sqm",
      priceInr: "price_inr",
      priceUsd: "price_usd",
      status: "status"
    };

    const sets = [];
    const values = [];
    for (const [key, column] of Object.entries(columnMap)) {
      if (req.body[key] !== undefined) {
        sets.push(`${column} = ?`);
        values.push(req.body[key]);
      }
    }
    if (sets.length === 0) throw new ApiError(400, "No fields to update.");

    values.push(req.params.id, req.user.eventId);
    const [result] = await pool.query(
      `UPDATE stalls SET ${sets.join(", ")}, updated_at = NOW() WHERE id = ? AND event_id = ?`,
      values
    );
    if (result.affectedRows === 0) throw new ApiError(404, "Stall not found.");

    res.json({ message: "Stall updated." });
  })
);

router.delete(
  "/:id",
  requireRole(...ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const [result] = await pool.query("DELETE FROM stalls WHERE id = ? AND event_id = ?", [
      req.params.id,
      req.user.eventId
    ]);
    if (result.affectedRows === 0) throw new ApiError(404, "Stall not found.");
    res.json({ message: "Stall deleted." });
  })
);

router.get(
  "/my-allocation",
  asyncHandler(async (req, res) => {
    if (!req.user.companyId) throw new ApiError(404, "No company profile is associated with this account.");

    const [rows] = await pool.query(
      `SELECT sa.*, s.stall_number, s.hall, s.block, s.area_sqm, s.stall_type
       FROM stall_allocations sa
       JOIN stalls s ON s.id = sa.stall_id
       JOIN exhibitor_event_profiles eep ON eep.id = sa.exhibitor_profile_id
       WHERE eep.company_id = ? AND sa.event_id = ? AND sa.released_at IS NULL
       LIMIT 1`,
      [req.user.companyId, req.user.eventId]
    );

    res.json({ allocation: rows[0] || null });
  })
);

router.post(
  "/allocations",
  requireRole(...ADMIN_ROLES),
  validate(createAllocationSchema),
  asyncHandler(async (req, res) => {
    const { stallId, exhibitorProfileId, notes } = req.body;

    const [stallRows] = await pool.query("SELECT * FROM stalls WHERE id = ? AND event_id = ? LIMIT 1", [
      stallId,
      req.user.eventId
    ]);
    if (stallRows.length === 0) throw new ApiError(404, "Stall not found.");
    if (stallRows[0].status === "booked") throw new ApiError(409, "This stall is already allocated.");

    const [profileRows] = await pool.query(
      "SELECT id FROM exhibitor_event_profiles WHERE id = ? AND event_id = ? LIMIT 1",
      [exhibitorProfileId, req.user.eventId]
    );
    if (profileRows.length === 0) throw new ApiError(404, "Exhibitor profile not found for this event.");

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [result] = await connection.query(
        `INSERT INTO stall_allocations (stall_id, event_id, exhibitor_profile_id, allocated_by, allocated_at, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, NOW(), ?, NOW(), NOW())`,
        [stallId, req.user.eventId, exhibitorProfileId, req.user.id, notes || null]
      );
      await connection.query("UPDATE stalls SET status = 'booked', updated_at = NOW() WHERE id = ?", [stallId]);

      await connection.commit();
      res.status(201).json({ message: "Stall allocated.", allocationId: result.insertId });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  })
);

router.delete(
  "/allocations/:id",
  requireRole(...ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query("SELECT * FROM stall_allocations WHERE id = ? AND event_id = ? LIMIT 1", [
      req.params.id,
      req.user.eventId
    ]);
    const allocation = rows[0];
    if (!allocation || allocation.released_at) throw new ApiError(404, "Active allocation not found.");

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query("UPDATE stall_allocations SET released_at = NOW(), released_by = ? WHERE id = ?", [
        req.user.id,
        allocation.id
      ]);
      await connection.query("UPDATE stalls SET status = 'available', updated_at = NOW() WHERE id = ?", [
        allocation.stall_id
      ]);
      await connection.commit();
      res.json({ message: "Allocation released." });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  })
);

module.exports = router;
