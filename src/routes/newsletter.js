const express = require("express");
const pool = require("../db/pool");

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALREADY_SUBSCRIBED_MESSAGE = "This email is already registered — you're already subscribed to our newsletter!";

router.post("/", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const sourcePage = req.body.sourcePage ? String(req.body.sourcePage).slice(0, 100) : null;

  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ message: "Please enter a valid email address." });
  }

  try {
    const [existing] = await pool.query(
      "SELECT id FROM newsletter_subscribers WHERE email = ? LIMIT 1",
      [email]
    );
    if (existing.length > 0) {
      return res.status(409).json({ message: ALREADY_SUBSCRIBED_MESSAGE });
    }

    await pool.query(
      "INSERT INTO newsletter_subscribers (email, source_page) VALUES (?, ?)",
      [email, sourcePage]
    );
    res.status(201).json({ message: "Subscribed successfully." });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      // Two simultaneous submits for the same email raced past the SELECT above.
      return res.status(409).json({ message: ALREADY_SUBSCRIBED_MESSAGE });
    }
    console.error("Newsletter signup failed:", err);
    res.status(500).json({ message: "Could not save your subscription. Please try again later." });
  }
});

module.exports = router;
