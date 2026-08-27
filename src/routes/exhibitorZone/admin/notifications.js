const express = require("express");
const pool = require("../../../db/pool");
const asyncHandler = require("../../../middleware/asyncHandler");
const requireAuth = require("../../../middleware/requireAuth");
const requireRole = require("../../../middleware/requireRole");
const requireEventContext = require("../../../middleware/requireEventContext");
const validate = require("../../../middleware/validate");
const { ApiError } = require("../../../middleware/errorHandler");
const { notifyUser } = require("../../../utils/notify");
const { sendNotificationSchema } = require("../../../validators/notification");

const router = express.Router();

const ADMIN_ROLES = ["super_admin", "organiser"];

router.use(requireAuth, requireEventContext, requireRole(...ADMIN_ROLES));

router.post(
  "/send",
  validate(sendNotificationSchema),
  asyncHandler(async (req, res) => {
    const { target, companyIds, title, message, type } = req.body;

    const params = [req.user.eventId];
    let companyFilter = "";
    if (target === "companies") {
      companyFilter = `AND uer.company_id IN (${companyIds.map(() => "?").join(",")})`;
      params.push(...companyIds);
    }

    const [recipients] = await pool.query(
      `SELECT DISTINCT uer.user_id
       FROM user_event_roles uer
       JOIN roles r ON r.id = uer.role_id
       WHERE uer.event_id = ? AND uer.is_active = 1
         AND r.name IN ('exhibitor_admin', 'exhibitor_staff')
         ${companyFilter}`,
      params
    );

    if (recipients.length === 0) throw new ApiError(400, "No matching exhibitor accounts to notify.");

    await Promise.all(recipients.map((r) => notifyUser(pool, { userId: r.user_id, title, message, type })));

    res.status(201).json({ message: "Notification sent.", recipientCount: recipients.length });
  })
);

module.exports = router;
