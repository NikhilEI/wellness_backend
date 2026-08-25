const crypto = require("crypto");
const express = require("express");
const pool = require("../../db/pool");
const asyncHandler = require("../../middleware/asyncHandler");
const requireAuth = require("../../middleware/requireAuth");
const requireRole = require("../../middleware/requireRole");
const validate = require("../../middleware/validate");
const { ApiError } = require("../../middleware/errorHandler");
const { createEventSchema, updateEventSchema } = require("../../validators/event");

const router = express.Router();

router.use(requireAuth);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    if (req.user.role === "super_admin") {
      const [rows] = await pool.query("SELECT * FROM events WHERE deleted_at IS NULL ORDER BY start_date DESC");
      return res.json({ events: rows });
    }

    const [rows] = await pool.query(
      `SELECT DISTINCT e.* FROM events e
       JOIN user_event_roles uer ON uer.event_id = e.id
       WHERE uer.user_id = ? AND uer.is_active = 1 AND e.deleted_at IS NULL
       ORDER BY e.start_date DESC`,
      [req.user.id]
    );
    res.json({ events: rows });
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query("SELECT * FROM events WHERE id = ? AND deleted_at IS NULL LIMIT 1", [req.params.id]);
    if (rows.length === 0) throw new ApiError(404, "Event not found.");
    res.json({ event: rows[0] });
  })
);

router.post(
  "/",
  requireRole("super_admin", "organiser"),
  validate(createEventSchema),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const [existing] = await pool.query("SELECT id FROM events WHERE slug = ? LIMIT 1", [b.slug]);
    if (existing.length > 0) throw new ApiError(409, "An event with this slug already exists.");

    const [result] = await pool.query(
      `INSERT INTO events
        (uuid, name, slug, edition, tagline, venue_name, venue_city, venue_country,
         start_date, end_date, primary_currency, status, timezone, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        crypto.randomUUID(),
        b.name,
        b.slug,
        b.edition || null,
        b.tagline || null,
        b.venueName || null,
        b.venueCity || null,
        b.venueCountry || null,
        b.startDate,
        b.endDate,
        b.primaryCurrency,
        b.status,
        b.timezone,
        req.user.id
      ]
    );

    res.status(201).json({ message: "Event created.", eventId: result.insertId });
  })
);

router.patch(
  "/:id",
  requireRole("super_admin", "organiser"),
  validate(updateEventSchema),
  asyncHandler(async (req, res) => {
    const columnMap = {
      name: "name",
      slug: "slug",
      edition: "edition",
      tagline: "tagline",
      venueName: "venue_name",
      venueCity: "venue_city",
      venueCountry: "venue_country",
      startDate: "start_date",
      endDate: "end_date",
      primaryCurrency: "primary_currency",
      timezone: "timezone",
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

    values.push(req.params.id);
    const [result] = await pool.query(`UPDATE events SET ${sets.join(", ")}, updated_at = NOW() WHERE id = ?`, values);
    if (result.affectedRows === 0) throw new ApiError(404, "Event not found.");

    res.json({ message: "Event updated." });
  })
);

router.delete(
  "/:id",
  requireRole("super_admin"),
  asyncHandler(async (req, res) => {
    const [result] = await pool.query("UPDATE events SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL", [
      req.params.id
    ]);
    if (result.affectedRows === 0) throw new ApiError(404, "Event not found.");
    res.json({ message: "Event deleted." });
  })
);

module.exports = router;
