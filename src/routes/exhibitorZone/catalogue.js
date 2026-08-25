const express = require("express");
const pool = require("../../db/pool");
const asyncHandler = require("../../middleware/asyncHandler");
const requireAuth = require("../../middleware/requireAuth");
const requireRole = require("../../middleware/requireRole");
const requireEventContext = require("../../middleware/requireEventContext");
const validate = require("../../middleware/validate");
const { ApiError } = require("../../middleware/errorHandler");
const { createCategorySchema, createItemSchema, updateItemSchema } = require("../../validators/catalogue");

const router = express.Router();

const ADMIN_ROLES = ["super_admin", "organiser"];

router.use(requireAuth, requireEventContext);

router.get(
  "/categories",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      "SELECT * FROM service_categories WHERE event_id = ? AND is_active = 1 ORDER BY sort_order, name",
      [req.user.eventId]
    );
    res.json({ categories: rows });
  })
);

router.post(
  "/categories",
  requireRole(...ADMIN_ROLES),
  validate(createCategorySchema),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const [result] = await pool.query(
      `INSERT INTO service_categories (event_id, name, slug, description, sort_order, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, NOW(), NOW())`,
      [req.user.eventId, b.name, b.slug, b.description || null, b.sortOrder]
    );
    res.status(201).json({ message: "Category created.", categoryId: result.insertId });
  })
);

router.get(
  "/items",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT si.*, sc.name AS category_name, sc.slug AS category_slug,
              (COALESCE(si.inventory_total, 0) - si.inventory_reserved - si.inventory_sold) AS inventory_available
       FROM service_items si
       JOIN service_categories sc ON sc.id = si.category_id
       WHERE si.event_id = ? AND si.is_active = 1
       ORDER BY sc.sort_order, si.sort_order, si.name`,
      [req.user.eventId]
    );
    res.json({ items: rows });
  })
);

router.get(
  "/items/:id",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      "SELECT * FROM service_items WHERE id = ? AND event_id = ? LIMIT 1",
      [req.params.id, req.user.eventId]
    );
    if (rows.length === 0) throw new ApiError(404, "Item not found.");
    res.json({ item: rows[0] });
  })
);

router.post(
  "/items",
  requireRole(...ADMIN_ROLES),
  validate(createItemSchema),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const [category] = await pool.query("SELECT id FROM service_categories WHERE id = ? AND event_id = ? LIMIT 1", [
      b.categoryId,
      req.user.eventId
    ]);
    if (category.length === 0) throw new ApiError(404, "Category not found for this event.");

    const [result] = await pool.query(
      `INSERT INTO service_items
        (uuid, event_id, category_id, sku, name, description, unit, price_inr, price_usd,
         late_surcharge_pct, tax_rate_pct, min_order_qty, max_order_qty, inventory_total,
         inventory_reserved, inventory_sold, requires_sq_footage, requires_terms, sort_order, is_active,
         created_at, updated_at)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 1, NOW(), NOW())`,
      [
        req.user.eventId,
        b.categoryId,
        b.sku,
        b.name,
        b.description || null,
        b.unit || "each",
        b.priceInr,
        b.priceUsd || null,
        b.lateSurchargePct,
        b.taxRatePct,
        b.minOrderQty,
        b.maxOrderQty || null,
        b.inventoryTotal ?? null
      ]
    );

    res.status(201).json({ message: "Item created.", itemId: result.insertId });
  })
);

router.patch(
  "/items/:id",
  requireRole(...ADMIN_ROLES),
  validate(updateItemSchema),
  asyncHandler(async (req, res) => {
    const columnMap = {
      sku: "sku",
      name: "name",
      description: "description",
      unit: "unit",
      priceInr: "price_inr",
      priceUsd: "price_usd",
      lateSurchargePct: "late_surcharge_pct",
      taxRatePct: "tax_rate_pct",
      minOrderQty: "min_order_qty",
      maxOrderQty: "max_order_qty",
      inventoryTotal: "inventory_total",
      isActive: "is_active"
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
      `UPDATE service_items SET ${sets.join(", ")}, updated_at = NOW() WHERE id = ? AND event_id = ?`,
      values
    );
    if (result.affectedRows === 0) throw new ApiError(404, "Item not found.");

    res.json({ message: "Item updated." });
  })
);

module.exports = router;
