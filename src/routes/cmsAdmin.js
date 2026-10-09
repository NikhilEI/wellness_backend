const express = require("express");
const { z } = require("zod");
const pool = require("../db/pool");
const { hashPassword, verifyPassword } = require("../utils/argon");
const { generateSecureToken, hashToken } = require("../utils/crypto");
const asyncHandler = require("../middleware/asyncHandler");
const { ApiError } = require("../middleware/errorHandler");
const { LEAD_TYPES } = require("../lib/leadTypes");

// Standalone admin panel (/cms-admin on the frontend): its own admins, sessions and cookie,
// fully separate from the Exhibitor Zone users. Two modules: Leads and SEO.
const router = express.Router();

const COOKIE_NAME = "cms_session";
const SESSION_HOURS = 12;
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const PAGE_SIZE = 25;
const EXPORT_LIMIT = 50000;

const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  maxAge: SESSION_HOURS * 60 * 60 * 1000,
  path: "/"
});

// ---------------------------------------------------------------- auth

// In-memory brute-force guard keyed by ip+email. Resets on restart, which is acceptable
// for a handful of internal admins.
const failedLogins = new Map();

function lockoutKey(req, email) {
  return `${req.ip}|${email}`;
}

function isLockedOut(key) {
  const entry = failedLogins.get(key);
  if (!entry) return false;
  if (entry.until && entry.until > Date.now()) return true;
  if (entry.until && entry.until <= Date.now()) failedLogins.delete(key);
  return false;
}

function recordFailure(key) {
  const entry = failedLogins.get(key) || { count: 0, until: 0 };
  entry.count += 1;
  if (entry.count >= MAX_FAILED_LOGINS) entry.until = Date.now() + LOCKOUT_MS;
  failedLogins.set(key, entry);
}

// Same Argon2 cost for unknown emails so response timing doesn't reveal which exist.
const dummyHashPromise = hashPassword("not-a-real-password-used-for-timing-only");

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(1).max(200)
});

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, "Please enter your email and password.");
    const { email, password } = parsed.data;

    const key = lockoutKey(req, email);
    if (isLockedOut(key)) {
      throw new ApiError(429, "Too many failed attempts. Please try again in 15 minutes.");
    }

    const [rows] = await pool.query("SELECT * FROM cms_admins WHERE email = ? AND is_active = 1 LIMIT 1", [email]);
    const admin = rows[0];
    const valid = await verifyPassword(admin ? admin.password_hash : await dummyHashPromise, password).catch(
      () => false
    );
    if (!admin || !valid) {
      recordFailure(key);
      throw new ApiError(401, "Invalid email or password.");
    }
    failedLogins.delete(key);

    const token = generateSecureToken(48);
    await pool.query("INSERT INTO cms_admin_sessions (token_hash, admin_id, expires_at) VALUES (?, ?, ?)", [
      hashToken(token),
      admin.id,
      new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000)
    ]);
    // Opportunistic cleanup of expired sessions.
    pool.query("DELETE FROM cms_admin_sessions WHERE expires_at < NOW()").catch(() => {});

    res.cookie(COOKIE_NAME, token, cookieOptions());
    res.json({ admin: { id: admin.id, email: admin.email, name: admin.name } });
  })
);

const requireCmsAdmin = asyncHandler(async (req, res, next) => {
  const token = req.cookies ? req.cookies[COOKIE_NAME] : null;
  if (!token) throw new ApiError(401, "Not authenticated.");
  const [rows] = await pool.query(
    `SELECT a.id, a.email, a.name FROM cms_admin_sessions s
     JOIN cms_admins a ON a.id = s.admin_id
     WHERE s.token_hash = ? AND s.expires_at > NOW() AND a.is_active = 1 LIMIT 1`,
    [hashToken(token)]
  );
  if (!rows[0]) throw new ApiError(401, "Session expired or invalid.");
  req.cmsAdmin = rows[0];
  next();
});

router.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const token = req.cookies ? req.cookies[COOKIE_NAME] : null;
    if (token) await pool.query("DELETE FROM cms_admin_sessions WHERE token_hash = ?", [hashToken(token)]);
    res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
    res.json({ message: "Logged out." });
  })
);

router.get("/me", requireCmsAdmin, (req, res) => {
  res.json({ admin: req.cmsAdmin });
});

// Everything below requires a logged-in CMS admin.
router.use(requireCmsAdmin);

// ---------------------------------------------------------------- leads module

function getLeadType(req) {
  const type = LEAD_TYPES[req.params.type];
  if (!type) throw new ApiError(404, "Unknown lead type.");
  return type;
}

function buildWhere(type, req) {
  const search = String(req.query.search || "").trim().slice(0, 100);
  const params = [];
  const clauses = [];
  if (search) {
    const like = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
    clauses.push(`(${type.search.map((c) => `${c} LIKE ?`).join(" OR ")})`);
    type.search.forEach(() => params.push(like));
  }
  // Optional filter: only the space-booking tab has a `source` column.
  const source = String(req.query.source || "");
  if (type.table === "space_bookings" && (source === "public" || source === "marketing")) {
    clauses.push("source = ?");
    params.push(source);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

router.get(
  "/leads",
  asyncHandler(async (req, res) => {
    const tabs = await Promise.all(
      Object.entries(LEAD_TYPES).map(async ([key, t]) => {
        const [rows] = await pool.query(`SELECT COUNT(*) AS total FROM ${t.table}`);
        return { key, label: t.label, total: rows[0].total };
      })
    );
    res.json({ tabs });
  })
);

router.get(
  "/leads/:type",
  asyncHandler(async (req, res) => {
    const type = getLeadType(req);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const { where, params } = buildWhere(type, req);
    const cols = type.columns.map(([key]) => key).join(", ");

    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM ${type.table} ${where}`, params);
    const [rows] = await pool.query(
      `SELECT ${cols} FROM ${type.table} ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, PAGE_SIZE, (page - 1) * PAGE_SIZE]
    );
    res.json({
      label: type.label,
      columns: type.columns.map(([key, label]) => ({ key, label })),
      rows,
      total,
      page,
      pageSize: PAGE_SIZE
    });
  })
);

function csvCell(value) {
  if (value === null || value === undefined) return "";
  let text = value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.join("; ") : String(value);
  // Neutralise spreadsheet formula injection from user-submitted text.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

router.get(
  "/leads/:type/export",
  asyncHandler(async (req, res) => {
    const type = getLeadType(req);
    const { where, params } = buildWhere(type, req);
    const cols = type.columns.map(([key]) => key).join(", ");
    const [rows] = await pool.query(
      `SELECT ${cols} FROM ${type.table} ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
      [...params, EXPORT_LIMIT]
    );
    const lines = [type.columns.map(([, label]) => csvCell(label)).join(",")];
    for (const row of rows) lines.push(type.columns.map(([key]) => csvCell(row[key])).join(","));

    res.set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${req.params.type}-leads-${new Date().toISOString().slice(0, 10)}.csv"`
    });
    res.send(`﻿${lines.join("\r\n")}`);
  })
);

// ---------------------------------------------------------------- SEO module

const pathSchema = z.string().regex(/^\/[a-z0-9\-/]*$/, "Invalid page path.").max(150);
const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional();
const optionalUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === "" || /^https?:\/\/\S+$/i.test(v) || v.startsWith("/"), "Must be an http(s) URL or a /path.")
  .transform((v) => v || null)
  .nullable()
  .optional();

const seoSchema = z.object({
  path: pathSchema,
  title: optionalText(200),
  description: optionalText(500),
  keywords: optionalText(500),
  canonicalUrl: optionalUrl,
  ogImage: optionalUrl
});

router.get(
  "/seo",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT path, title, description, keywords, canonical_url AS canonicalUrl, og_image AS ogImage,
              updated_by AS updatedBy, updated_at AS updatedAt FROM seo_pages`
    );
    res.json({ overrides: rows });
  })
);

router.put(
  "/seo",
  asyncHandler(async (req, res) => {
    const parsed = seoSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(
        400,
        "Please check the highlighted fields.",
        parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message }))
      );
    }
    const d = parsed.data;
    await pool.query(
      `INSERT INTO seo_pages (path, title, description, keywords, canonical_url, og_image, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE title = VALUES(title), description = VALUES(description),
         keywords = VALUES(keywords), canonical_url = VALUES(canonical_url),
         og_image = VALUES(og_image), updated_by = VALUES(updated_by)`,
      [d.path, d.title ?? null, d.description ?? null, d.keywords ?? null, d.canonicalUrl ?? null, d.ogImage ?? null, req.cmsAdmin.email]
    );
    res.json({ message: "SEO settings saved." });
  })
);

// Remove the override so the page goes back to its built-in defaults.
router.delete(
  "/seo",
  asyncHandler(async (req, res) => {
    const parsed = pathSchema.safeParse(req.query.path);
    if (!parsed.success) throw new ApiError(400, "Invalid page path.");
    await pool.query("DELETE FROM seo_pages WHERE path = ?", [parsed.data]);
    res.json({ message: "Reset to defaults." });
  })
);

module.exports = router;
