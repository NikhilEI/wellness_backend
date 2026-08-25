const crypto = require("crypto");
const express = require("express");
const pool = require("../../db/pool");
const asyncHandler = require("../../middleware/asyncHandler");
const requireAuth = require("../../middleware/requireAuth");
const requireRole = require("../../middleware/requireRole");
const requireEventContext = require("../../middleware/requireEventContext");
const requireCompanyAccess = require("../../middleware/requireCompanyAccess");
const { ApiError } = require("../../middleware/errorHandler");
const { resolveOwnProfileId } = require("../../utils/exhibitorProfile");
const { notifyUser, notifyAdmins } = require("../../utils/notify");
const { FORM_SCHEMAS } = require("../../validators/forms");
const { z } = require("zod");

const router = express.Router();

const ADMIN_ROLES = ["super_admin", "organiser"];
const EDITABLE_STATUSES = ["draft", "needs_info", "rejected"];

router.use(requireAuth, requireEventContext);

router.get(
  "/templates",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      "SELECT id, uuid, name, slug, description, form_type, `schema`, deadline, requires_approval, allow_multiple, sort_order FROM form_templates WHERE event_id = ? AND is_active = 1 ORDER BY sort_order",
      [req.user.eventId]
    );
    const templates = rows.map((r) => ({ ...r, schema: JSON.parse(r.schema) }));
    res.json({
      mandatory: templates.filter((t) => t.form_type === "mandatory"),
      additional: templates.filter((t) => t.form_type !== "mandatory")
    });
  })
);

router.get(
  "/templates/:slug",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      "SELECT * FROM form_templates WHERE event_id = ? AND slug = ? AND is_active = 1 LIMIT 1",
      [req.user.eventId, req.params.slug]
    );
    if (rows.length === 0) throw new ApiError(404, "Form template not found.");
    res.json({ template: { ...rows[0], schema: JSON.parse(rows[0].schema) } });
  })
);

router.post(
  "/submissions/:slug",
  asyncHandler(async (req, res) => {
    const schema = FORM_SCHEMAS.get(req.params.slug);
    if (!schema) throw new ApiError(404, "Unknown form template.");

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      const errors = parsed.error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message }));
      throw new ApiError(400, "Please check the highlighted fields.", errors);
    }

    const [templateRows] = await pool.query(
      "SELECT * FROM form_templates WHERE event_id = ? AND slug = ? AND is_active = 1 LIMIT 1",
      [req.user.eventId, req.params.slug]
    );
    const template = templateRows[0];
    if (!template) throw new ApiError(404, "Form template not found.");

    const profileId = await resolveOwnProfileId(pool, req);
    const dataJson = JSON.stringify(parsed.data);
    const initialStatus = template.requires_approval ? "submitted" : "approved";

    const [existingRows] = await pool.query(
      "SELECT * FROM form_submissions WHERE form_template_id = ? AND event_id = ? AND exhibitor_profile_id = ? ORDER BY created_at DESC LIMIT 1",
      [template.id, req.user.eventId, profileId]
    );
    const existing = existingRows[0];

    if (existing && !template.allow_multiple) {
      if (!EDITABLE_STATUSES.includes(existing.status)) {
        throw new ApiError(409, "You have already submitted this form.");
      }

      await pool.query(
        `UPDATE form_submissions
         SET data = ?, status = ?, version = version + 1, submitted_at = NOW(), updated_at = NOW(),
             reviewer_id = NULL, reviewed_at = NULL, reviewer_notes = NULL, locked_at = ?
         WHERE id = ?`,
        [dataJson, initialStatus, initialStatus === "approved" ? new Date() : null, existing.id]
      );

      await pool.query(
        "INSERT INTO form_submission_history (submission_id, event_id, changed_by, from_status, to_status, data_snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())",
        [existing.id, req.user.eventId, req.user.id, existing.status, initialStatus, dataJson]
      );

      return res.json({ message: "Form resubmitted.", submissionId: existing.id });
    }

    const [result] = await pool.query(
      `INSERT INTO form_submissions
        (uuid, form_template_id, event_id, exhibitor_profile_id, submitted_by, data, status,
         submitted_at, locked_at, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, 1, NOW(), NOW())`,
      [crypto.randomUUID(), template.id, req.user.eventId, profileId, req.user.id, dataJson, initialStatus, initialStatus === "approved" ? new Date() : null]
    );

    await pool.query(
      "INSERT INTO form_submission_history (submission_id, event_id, changed_by, to_status, data_snapshot, created_at) VALUES (?, ?, ?, ?, ?, NOW())",
      [result.insertId, req.user.eventId, req.user.id, initialStatus, dataJson]
    );

    if (template.requires_approval) {
      notifyAdmins(pool, req.user.eventId, {
        title: "New form submission",
        message: `A new "${template.name}" submission needs review.`,
        type: "info"
      }).catch((err) => console.error("Failed to notify admins of form submission:", err));
    }

    res.status(201).json({ message: "Form submitted.", submissionId: result.insertId, status: initialStatus });
  })
);

router.get(
  "/submissions",
  asyncHandler(async (req, res) => {
    if (ADMIN_ROLES.includes(req.user.role)) {
      const params = [req.user.eventId];
      let filter = "";
      if (req.query.status) {
        filter += " AND fs.status = ?";
        params.push(req.query.status);
      }
      if (req.query.templateSlug) {
        filter += " AND ft.slug = ?";
        params.push(req.query.templateSlug);
      }

      const [rows] = await pool.query(
        `SELECT fs.*, ft.name AS template_name, c.display_name AS company_name
         FROM form_submissions fs
         JOIN form_templates ft ON ft.id = fs.form_template_id
         JOIN exhibitor_event_profiles eep ON eep.id = fs.exhibitor_profile_id
         JOIN companies c ON c.id = eep.company_id
         WHERE fs.event_id = ? ${filter}
         ORDER BY fs.created_at DESC`,
        params
      );
      return res.json({ submissions: rows.map((r) => ({ ...r, data: JSON.parse(r.data) })) });
    }

    const profileId = await resolveOwnProfileId(pool, req);
    const [rows] = await pool.query(
      `SELECT fs.*, ft.name AS template_name FROM form_submissions fs
       JOIN form_templates ft ON ft.id = fs.form_template_id
       WHERE fs.event_id = ? AND fs.exhibitor_profile_id = ?
       ORDER BY fs.created_at DESC`,
      [req.user.eventId, profileId]
    );
    res.json({ submissions: rows.map((r) => ({ ...r, data: JSON.parse(r.data) })) });
  })
);

router.get(
  "/submissions/:id",
  requireCompanyAccess(async (req) => {
    const [rows] = await pool.query("SELECT exhibitor_profile_id FROM form_submissions WHERE id = ?", [req.params.id]);
    if (!rows[0]) return null;
    const [profile] = await pool.query("SELECT company_id FROM exhibitor_event_profiles WHERE id = ?", [
      rows[0].exhibitor_profile_id
    ]);
    return profile[0] ? profile[0].company_id : null;
  }),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT fs.*, ft.name AS template_name, c.display_name AS company_name FROM form_submissions fs
       JOIN form_templates ft ON ft.id = fs.form_template_id
       JOIN exhibitor_event_profiles eep ON eep.id = fs.exhibitor_profile_id
       JOIN companies c ON c.id = eep.company_id
       WHERE fs.id = ? AND fs.event_id = ? LIMIT 1`,
      [req.params.id, req.user.eventId]
    );
    if (rows.length === 0) throw new ApiError(404, "Submission not found.");
    res.json({ submission: { ...rows[0], data: JSON.parse(rows[0].data) } });
  })
);

const reviewSchema = z.object({
  status: z.enum(["under_review", "changes_requested", "approved", "rejected"]),
  reviewerNotes: z.string().trim().max(2000).optional()
});

router.patch(
  "/submissions/:id/status",
  requireRole(...ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, "Invalid status update.", parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })));
    }
    const { status, reviewerNotes } = parsed.data;

    const [rows] = await pool.query(
      `SELECT fs.*, ft.name AS template_name FROM form_submissions fs JOIN form_templates ft ON ft.id = fs.form_template_id WHERE fs.id = ? AND fs.event_id = ? LIMIT 1`,
      [req.params.id, req.user.eventId]
    );
    const submission = rows[0];
    if (!submission) throw new ApiError(404, "Submission not found.");

    await pool.query(
      `UPDATE form_submissions
       SET status = ?, reviewer_id = ?, reviewed_at = NOW(), reviewer_notes = ?, locked_at = ?, updated_at = NOW()
       WHERE id = ?`,
      [status, req.user.id, reviewerNotes || null, status === "approved" ? new Date() : null, submission.id]
    );

    await pool.query(
      "INSERT INTO form_submission_history (submission_id, event_id, changed_by, from_status, to_status, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())",
      [submission.id, req.user.eventId, req.user.id, submission.status, status, reviewerNotes || null]
    );

    const [companyUsers] = await pool.query(
      "SELECT DISTINCT user_id FROM user_event_roles WHERE company_id = (SELECT company_id FROM exhibitor_event_profiles WHERE id = ?) AND event_id = ?",
      [submission.exhibitor_profile_id, req.user.eventId]
    );
    await Promise.all(
      companyUsers.map((u) =>
        notifyUser(pool, {
          userId: u.user_id,
          title: `"${submission.template_name}" ${status.replace("_", " ")}`,
          message: reviewerNotes || `Your "${submission.template_name}" submission is now ${status.replace("_", " ")}.`,
          type: status === "approved" ? "success" : status === "rejected" ? "error" : "warning"
        })
      )
    );

    res.json({ message: "Submission status updated." });
  })
);

module.exports = router;
