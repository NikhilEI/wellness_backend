const express = require("express");
const pool = require("../db/pool");
const { sendMail, buildConfirmationEmail } = require("../lib/mailer");

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_RE = /^[0-9]{10}$/;
const NAME_RE = /^[A-Za-z\s'-]{2,30}$/;
const ORG_RE = /^.{2,30}$/;
const CITY_RE = /^[A-Za-z\s'-]{2,50}$/;

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

async function verifyRecaptcha(token, remoteIp) {
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) {
    // Not configured yet — don't block submissions while the site key/secret are being set up.
    return true;
  }
  if (!token) return false;

  const params = new URLSearchParams({ secret, response: token });
  if (remoteIp) params.set("remoteip", remoteIp);

  const res = await fetch("https://www.google.com/recaptcha/api/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString()
  });
  const body = await res.json();
  return body.success === true;
}

router.post("/", async (req, res) => {
  const data = {};
  for (const key of REQUIRED_FIELDS) {
    data[key] = String(req.body[key] || "").trim();
  }
  data.designation = String(req.body.designation || "").trim();
  data.shellSpace = String(req.body.shellSpace || "").trim();
  data.recaptchaToken = String(req.body.recaptchaToken || "").trim();

  const missing = REQUIRED_FIELDS.filter((key) => !data[key]);
  if (missing.length > 0) {
    return res.status(400).json({ message: "Please fill in all required fields." });
  }

  if (!EMAIL_RE.test(data.email)) {
    return res.status(400).json({ message: "Please enter a valid email address." });
  }

  if (!MOBILE_RE.test(data.mobileNo)) {
    return res.status(400).json({ message: "Please enter a valid 10-digit mobile number." });
  }

  if (!NAME_RE.test(data.firstName) || !NAME_RE.test(data.lastName)) {
    return res.status(400).json({ message: "First and last name must be letters only, 2-30 characters." });
  }

  if (!ORG_RE.test(data.organisation)) {
    return res.status(400).json({ message: "Organisation name must be between 2 and 30 characters." });
  }

  if (!CITY_RE.test(data.city)) {
    return res.status(400).json({ message: "City must be letters only, 2-50 characters." });
  }

  try {
    const recaptchaOk = await verifyRecaptcha(data.recaptchaToken, req.ip);
    if (!recaptchaOk) {
      return res.status(400).json({ message: "Captcha verification failed. Please try again." });
    }
  } catch (err) {
    console.error("reCAPTCHA verification request failed:", err);
    return res.status(502).json({ message: "Could not verify captcha right now. Please try again." });
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

    const { text, html } = buildConfirmationEmail({
      firstName: data.firstName,
      eventName: "Wellness India Expo 2027 - Space Booking",
      actionPhrase: "an exhibitor",
      fields: [
        ["Full Name", data.firstName],
        ["Last Name", data.lastName],
        ["Organisation", data.organisation],
        ["Designation", data.designation],
        ["Email", data.email],
        ["Mobile No", data.mobileNo],
        ["City", data.city],
        ["Country", data.country],
        ["Space Required", data.shellSpace],
        ["How did you hear about the expo?", data.learnAboutExpo]
      ]
    });

    sendMail({
      to: data.email,
      subject: "Thanks for your enquiry — Wellness India Expo 2027",
      text,
      html
    });
  } catch (err) {
    console.error("Space booking submission failed:", err);
    res.status(500).json({ message: "Could not submit your enquiry. Please try again later." });
  }
});

module.exports = router;
