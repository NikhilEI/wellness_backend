const express = require("express");
const pool = require("../../../db/pool");
const asyncHandler = require("../../../middleware/asyncHandler");
const requireAuth = require("../../../middleware/requireAuth");
const requireRole = require("../../../middleware/requireRole");
const requireEventContext = require("../../../middleware/requireEventContext");

const router = express.Router();

router.use(requireAuth, requireEventContext, requireRole("super_admin", "organiser", "finance"));

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const eventId = req.user.eventId;

    const [[companies]] = await pool.query(
      `SELECT
         SUM(profile_status = 'pending') AS pending,
         SUM(profile_status = 'approved') AS approved,
         SUM(profile_status = 'rejected') AS rejected,
         SUM(profile_status = 'suspended') AS suspended
       FROM exhibitor_event_profiles WHERE event_id = ?`,
      [eventId]
    );

    const [[orders]] = await pool.query(
      `SELECT COUNT(*) AS total, COALESCE(SUM(grand_total), 0) AS revenue,
              SUM(payment_status = 'unpaid') AS unpaid
       FROM orders WHERE event_id = ?`,
      [eventId]
    );

    const [[stalls]] = await pool.query(
      `SELECT COUNT(*) AS total, SUM(status = 'booked') AS booked, SUM(status = 'available') AS available,
              SUM(status = 'held') AS held, SUM(status = 'blocked') AS blocked
       FROM stalls WHERE event_id = ?`,
      [eventId]
    );

    const [[passes]] = await pool.query(
      "SELECT COUNT(*) AS issued FROM passes WHERE event_id = ? AND status IN ('issued', 'printed')",
      [eventId]
    );

    const [[submissions]] = await pool.query(
      "SELECT SUM(status = 'submitted') AS pendingReview FROM form_submissions WHERE event_id = ?",
      [eventId]
    );

    res.json({
      companies: {
        pending: Number(companies.pending) || 0,
        approved: Number(companies.approved) || 0,
        rejected: Number(companies.rejected) || 0,
        suspended: Number(companies.suspended) || 0
      },
      orders: {
        total: Number(orders.total) || 0,
        revenue: Number(orders.revenue) || 0,
        unpaid: Number(orders.unpaid) || 0
      },
      stalls: {
        total: Number(stalls.total) || 0,
        booked: Number(stalls.booked) || 0,
        available: Number(stalls.available) || 0,
        held: Number(stalls.held) || 0,
        blocked: Number(stalls.blocked) || 0
      },
      passesIssued: Number(passes.issued) || 0,
      formsPendingReview: Number(submissions.pendingReview) || 0
    });
  })
);

module.exports = router;
