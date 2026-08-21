const express = require("express");
const pool = require("../db/pool");

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_RE = /^[0-9]{6,20}$/;
const NAME_RE = /^.{2,30}$/;

const REQUIRED_FIELDS = [
  "firstName",
  "lastName",
  "organisation",
  "email",
  "learnAboutExpo",
  "city",
  "country",
  "mobileNo"
];

router.post("/", async (req, res) => {
  const data = {};
  for (const key of REQUIRED_FIELDS) {
    data[key] = String(req.body[key] || "").trim();
  }
  data.designation = String(req.body.designation || "").trim();
  data.shellSpace = String(req.body.shellSpace || "").trim();

  const missing = REQUIRED_FIELDS.filter((key) => !data[key]);
  if (missing.length > 0) {
    return res.status(400).json({ message: "Please fill in all required fields." });
  }

  if (!EMAIL_RE.test(data.email)) {
    return res.status(400).json({ message: "Please enter a valid email address." });
  }

  if (!MOBILE_RE.test(data.mobileNo)) {
    return res.status(400).json({ message: "Please enter a valid mobile number (digits only, 6-20 characters)." });
  }

  if (!NAME_RE.test(data.firstName) || !NAME_RE.test(data.lastName)) {
    return res.status(400).json({ message: "First and last name must be between 2 and 30 characters." });
  }

  if (!NAME_RE.test(data.organisation)) {
    return res.status(400).json({ message: "Organisation name must be between 2 and 30 characters." });
  }

  try {
    await pool.query(
      `INSERT INTO space_bookings
        (first_name, last_name, organisation, designation, email, learn_about_expo, city, country, mobile_no, shell_space)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.firstName,
        data.lastName,
        data.organisation,
        data.designation || null,
        data.email.toLowerCase(),
        data.learnAboutExpo,
        data.city,
        data.country,
        data.mobileNo,
        data.shellSpace || null
      ]
    );
    res.status(201).json({ message: "Booking enquiry submitted successfully." });
  } catch (err) {
    console.error("Space booking submission failed:", err);
    res.status(500).json({ message: "Could not submit your enquiry. Please try again later." });
  }
});

module.exports = router;
