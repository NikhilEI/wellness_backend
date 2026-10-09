const crypto = require("crypto");
const express = require("express");
const pool = require("../db/pool");
const asyncHandler = require("../middleware/asyncHandler");
const { ApiError } = require("../middleware/errorHandler");
const { LEAD_TYPES } = require("../lib/leadTypes");

// Read-only lead feed for an external CRM. One dynamic endpoint serves every form:
//   GET /api/crm/forms
//   GET /api/crm/leads/:form?from=&to=&since_id=&page=&limit=&order=&q=&source=&format=
// Authenticated with an API key (CRM_API_KEYS in .env), sent as `X-API-Key` or `Authorization: Bearer`.
const router = express.Router();

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const CSV_MAX_ROWS = 50000;

const sha256 = (value) => crypto.createHash("sha256").update(String(value)).digest();

function configuredKeys() {
  return (process.env.CRM_API_KEYS || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean)
    .map(sha256);
}

// Constant-time comparison of key hashes so response timing can't be used to guess a key.
const requireApiKey = (req, res, next) => {
  const keys = configuredKeys();
  if (keys.length === 0) return next(new ApiError(503, "CRM API is not enabled (no API keys configured)."));

  const header = req.get("authorization") || "";
  const provided = req.get("x-api-key") || (header.startsWith("Bearer ") ? header.slice(7).trim() : "");
  if (!provided) return next(new ApiError(401, "Missing API key. Send it as the X-API-Key header."));

  const providedHash = sha256(provided);
  const ok = keys.reduce((match, key) => crypto.timingSafeEqual(key, providedHash) || match, false);
  if (!ok) return next(new ApiError(401, "Invalid API key."));
  next();
};

router.use(requireApiKey);

// ---- date parsing -----------------------------------------------------------------------
// Accepts YYYY-MM-DD (whole day) or a full ISO-8601 datetime. Date-only values are read in
// the server's local time zone, the same zone the created_at column is stored in.
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDateParam(name, value, { endOfRange }) {
  if (value === undefined || value === "") return null;
  const raw = String(value).trim();
  const dateOnly = DATE_ONLY.exec(raw);
  let date;
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    // `to=2026-10-09` includes the whole of that day, so the range ends at the next midnight.
    date = new Date(Number(y), Number(m) - 1, Number(d) + (endOfRange ? 1 : 0));
    if (date.getMonth() !== Number(m) - 1) date = new Date(NaN); // rejects e.g. 2026-02-31
  } else {
    date = new Date(raw);
  }
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(400, `Invalid '${name}'. Use YYYY-MM-DD or an ISO-8601 datetime.`);
  }
  return { date, exclusive: Boolean(dateOnly && endOfRange) };
}

function positiveInt(name, value, fallback, max) {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new ApiError(400, `'${name}' must be a positive integer.`);
  return max ? Math.min(n, max) : n;
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  let text = value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.join("; ") : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; // neutralise spreadsheet formula injection
  return `"${text.replace(/"/g, '""')}"`;
}

// ---- endpoints ---------------------------------------------------------------------------

// Discovery: lists every form the CRM can pull, its fields, and the total/latest id.
router.get(
  "/forms",
  asyncHandler(async (req, res) => {
    const forms = await Promise.all(
      Object.entries(LEAD_TYPES).map(async ([key, t]) => {
        const [[row]] = await pool.query(`SELECT COUNT(*) AS total, MAX(id) AS lastId, MAX(created_at) AS lastCreatedAt FROM ${t.table}`);
        return {
          form: key,
          label: t.label,
          total: row.total,
          lastId: row.lastId,
          lastCreatedAt: row.lastCreatedAt,
          fields: t.columns.map(([field, label]) => ({ field, label })),
          filters: ["from", "to", "since_id", "q", ...(t.table === "space_bookings" ? ["source"] : [])]
        };
      })
    );
    res.json({ forms });
  })
);

router.get(
  "/leads/:form",
  asyncHandler(async (req, res) => {
    const type = LEAD_TYPES[req.params.form];
    if (!type) {
      throw new ApiError(404, `Unknown form '${req.params.form}'. Valid forms: ${Object.keys(LEAD_TYPES).join(", ")}.`);
    }

    const q = req.query;
    const clauses = [];
    const params = [];

    const from = parseDateParam("from", q.from, { endOfRange: false });
    const to = parseDateParam("to", q.to, { endOfRange: true });
    if (from) {
      clauses.push("created_at >= ?");
      params.push(from.date);
    }
    if (to) {
      clauses.push(to.exclusive ? "created_at < ?" : "created_at <= ?");
      params.push(to.date);
    }
    if (from && to && from.date > to.date) throw new ApiError(400, "'from' must not be after 'to'.");

    // Incremental sync: pass the highest id you've already stored to get only newer leads.
    if (q.since_id !== undefined && q.since_id !== "") {
      const sinceId = Number(q.since_id);
      if (!Number.isInteger(sinceId) || sinceId < 0) throw new ApiError(400, "'since_id' must be a non-negative integer.");
      clauses.push("id > ?");
      params.push(sinceId);
    }

    const search = String(q.q || "").trim().slice(0, 100);
    if (search) {
      const like = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
      clauses.push(`(${type.search.map((c) => `${c} LIKE ?`).join(" OR ")})`);
      type.search.forEach(() => params.push(like));
    }

    if (q.source !== undefined && q.source !== "") {
      if (type.table !== "space_bookings") throw new ApiError(400, "'source' is only supported for the space-booking form.");
      if (q.source !== "public" && q.source !== "marketing") throw new ApiError(400, "'source' must be 'public' or 'marketing'.");
      clauses.push("source = ?");
      params.push(q.source);
    }

    const order = String(q.order || "asc").toLowerCase();
    if (order !== "asc" && order !== "desc") throw new ApiError(400, "'order' must be 'asc' or 'desc'.");

    const format = String(q.format || "json").toLowerCase();
    if (format !== "json" && format !== "csv") throw new ApiError(400, "'format' must be 'json' or 'csv'.");

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const cols = type.columns.map(([key]) => key).join(", ");
    const orderBy = `ORDER BY id ${order.toUpperCase()}`;

    if (format === "csv") {
      const [rows] = await pool.query(`SELECT ${cols} FROM ${type.table} ${where} ${orderBy} LIMIT ?`, [...params, CSV_MAX_ROWS]);
      const lines = [type.columns.map(([key]) => csvCell(key)).join(",")];
      for (const row of rows) lines.push(type.columns.map(([key]) => csvCell(row[key])).join(","));
      res.set({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${req.params.form}-leads.csv"`
      });
      return res.send(`﻿${lines.join("\r\n")}`);
    }

    const limit = positiveInt("limit", q.limit, DEFAULT_LIMIT, MAX_LIMIT);
    const page = positiveInt("page", q.page, 1);

    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM ${type.table} ${where}`, params);
    const [rows] = await pool.query(`SELECT ${cols} FROM ${type.table} ${where} ${orderBy} LIMIT ? OFFSET ?`, [
      ...params,
      limit,
      (page - 1) * limit
    ]);

    res.json({
      form: req.params.form,
      label: type.label,
      total,
      count: rows.length,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasMore: page * limit < total,
      lastId: rows.length ? rows[rows.length - 1].id : null,
      data: rows
    });
  })
);

module.exports = router;
