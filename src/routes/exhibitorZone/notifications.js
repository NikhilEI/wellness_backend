const express = require("express");
const pool = require("../../db/pool");
const asyncHandler = require("../../middleware/asyncHandler");
const requireAuth = require("../../middleware/requireAuth");
const { ApiError } = require("../../middleware/errorHandler");

const router = express.Router();

router.use(requireAuth);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50, Number(req.query.pageSize) || 20);

    const [rows] = await pool.query(
      "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
      [req.user.id, pageSize, (page - 1) * pageSize]
    );
    const [[{ unread }]] = await pool.query(
      "SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND is_read = 0",
      [req.user.id]
    );

    res.json({ notifications: rows, unreadCount: unread, page, pageSize });
  })
);

router.patch(
  "/:id/read",
  asyncHandler(async (req, res) => {
    const [result] = await pool.query("UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?", [
      req.params.id,
      req.user.id
    ]);
    if (result.affectedRows === 0) throw new ApiError(404, "Notification not found.");
    res.json({ message: "Marked as read." });
  })
);

router.patch(
  "/read-all",
  asyncHandler(async (req, res) => {
    await pool.query("UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0", [req.user.id]);
    res.json({ message: "All notifications marked as read." });
  })
);

module.exports = router;
