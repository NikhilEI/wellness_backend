const express = require("express");
const pool = require("../../db/pool");
const asyncHandler = require("../../middleware/asyncHandler");
const requireAuth = require("../../middleware/requireAuth");
const requireRole = require("../../middleware/requireRole");
const requireEventContext = require("../../middleware/requireEventContext");
const requireCompanyAccess = require("../../middleware/requireCompanyAccess");
const validate = require("../../middleware/validate");
const { ApiError } = require("../../middleware/errorHandler");
const { resolveOwnProfileId } = require("../../utils/exhibitorProfile");
const { notifyUser } = require("../../utils/notify");
const { updatePaymentStatusSchema } = require("../../validators/order");

const router = express.Router();

const ADMIN_ROLES = ["super_admin", "organiser", "finance"];

router.use(requireAuth, requireEventContext);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    if (ADMIN_ROLES.includes(req.user.role)) {
      const [rows] = await pool.query(
        `SELECT o.*, c.display_name AS company_name
         FROM orders o
         JOIN exhibitor_event_profiles eep ON eep.id = o.exhibitor_profile_id
         JOIN companies c ON c.id = eep.company_id
         WHERE o.event_id = ?
         ORDER BY o.created_at DESC`,
        [req.user.eventId]
      );
      return res.json({ orders: rows });
    }

    const profileId = await resolveOwnProfileId(pool, req);
    const [rows] = await pool.query(
      "SELECT * FROM orders WHERE event_id = ? AND exhibitor_profile_id = ? ORDER BY created_at DESC",
      [req.user.eventId, profileId]
    );
    res.json({ orders: rows });
  })
);

router.get(
  "/:id",
  requireCompanyAccess(async (req) => {
    const [rows] = await pool.query(
      `SELECT eep.company_id FROM orders o JOIN exhibitor_event_profiles eep ON eep.id = o.exhibitor_profile_id WHERE o.id = ?`,
      [req.params.id]
    );
    return rows[0] ? rows[0].company_id : null;
  }),
  asyncHandler(async (req, res) => {
    const [orderRows] = await pool.query("SELECT * FROM orders WHERE id = ? AND event_id = ? LIMIT 1", [
      req.params.id,
      req.user.eventId
    ]);
    if (orderRows.length === 0) throw new ApiError(404, "Order not found.");

    const [items] = await pool.query("SELECT * FROM order_items WHERE order_id = ?", [req.params.id]);
    const [invoiceRows] = await pool.query("SELECT * FROM invoices WHERE order_id = ? LIMIT 1", [req.params.id]);

    res.json({ order: orderRows[0], items, invoice: invoiceRows[0] || null });
  })
);

router.patch(
  "/:id/payment-status",
  requireRole(...ADMIN_ROLES),
  validate(updatePaymentStatusSchema),
  asyncHandler(async (req, res) => {
    const { paymentStatus, amountPaid } = req.body;

    const [orderRows] = await pool.query(
      `SELECT o.*, c.display_name AS company_name FROM orders o
       JOIN exhibitor_event_profiles eep ON eep.id = o.exhibitor_profile_id
       JOIN companies c ON c.id = eep.company_id
       WHERE o.id = ? AND o.event_id = ? LIMIT 1`,
      [req.params.id, req.user.eventId]
    );
    const order = orderRows[0];
    if (!order) throw new ApiError(404, "Order not found.");

    const invoiceStatusMap = { unpaid: "sent", partially_paid: "partially_paid", paid: "paid", refunded: "void" };
    const paid = paymentStatus === "paid" ? Number(order.grand_total) : paymentStatus === "partially_paid" ? amountPaid ?? 0 : 0;
    const due = Math.max(0, Number(order.grand_total) - paid);

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      await connection.query("UPDATE orders SET payment_status = ?, updated_at = NOW() WHERE id = ?", [
        paymentStatus,
        order.id
      ]);
      await connection.query(
        `UPDATE invoices SET invoice_status = ?, amount_paid = ?, amount_due = ?, paid_at = ?, updated_at = NOW() WHERE order_id = ?`,
        [invoiceStatusMap[paymentStatus], paid, due, paymentStatus === "paid" ? new Date() : null, order.id]
      );
      await connection.query(
        "INSERT INTO audit_logs (event_id, user_id, action, entity_type, entity_id, new_value, created_at) VALUES (?, ?, 'order.payment_status_updated', 'order', ?, ?, NOW())",
        [req.user.eventId, req.user.id, order.id, JSON.stringify({ paymentStatus, amountPaid: paid })]
      );

      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }

    const [companyUsers] = await pool.query(
      "SELECT DISTINCT user_id FROM user_event_roles WHERE company_id = (SELECT company_id FROM exhibitor_event_profiles WHERE id = ?) AND event_id = ?",
      [order.exhibitor_profile_id, req.user.eventId]
    );
    await Promise.all(
      companyUsers.map((u) =>
        notifyUser(pool, {
          userId: u.user_id,
          title: "Order payment status updated",
          message: `Order ${order.order_number} is now marked as ${paymentStatus.replace("_", " ")}.`,
          type: paymentStatus === "paid" ? "success" : "info"
        })
      )
    );

    res.json({ message: "Payment status updated." });
  })
);

module.exports = router;
