const express = require("express");
const pool = require("../db/pool");

const router = express.Router();

// Public, read-only: the frontend calls this from generateMetadata() to apply any SEO
// overrides saved in the CMS admin panel. Returns {} when a page has no override.
router.get("/", async (req, res) => {
  const path = String(req.query.path || "");
  if (!/^\/[a-z0-9\-/]*$/.test(path)) return res.json({});
  try {
    const [rows] = await pool.query(
      "SELECT title, description, keywords, canonical_url AS canonicalUrl, og_image AS ogImage FROM seo_pages WHERE path = ? LIMIT 1",
      [path]
    );
    res.set("Cache-Control", "public, max-age=30");
    res.json(rows[0] || {});
  } catch (err) {
    console.error("SEO lookup failed:", err);
    res.json({});
  }
});

module.exports = router;
