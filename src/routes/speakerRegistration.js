const express = require("express");
const pool = require("../db/pool");
const { sendMail, escapeHtml } = require("../lib/mailer");

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_RE = /^[0-9]{10}$/;
const NAME_RE = /^[A-Za-z\s'-]{2,50}$/;
const ORG_RE = /^.{2,150}$/;
const CITY_RE = /^[A-Za-z\s'-]{2,100}$/;
const TITLE_OPTIONS = ["Mr.", "Mrs.", "Miss", "Ms.", "Dr.", "Prof.", "Other"];

const REQUIRED_FIELDS = ["title", "firstName", "organisation", "designation", "email", "mobile", "city", "country"];

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
  data.lastName = String(req.body.lastName || "").trim();
  data.address = String(req.body.address || "").trim();
  data.zipCode = String(req.body.zipCode || "").trim();
  data.state = String(req.body.state || "").trim();
  data.termsAccepted = Boolean(req.body.termsAccepted);
  data.recaptchaToken = String(req.body.recaptchaToken || "").trim();

  const missing = REQUIRED_FIELDS.filter((key) => !data[key]);
  if (missing.length > 0) {
    return res.status(400).json({ message: "Please fill in all required fields." });
  }

  if (!TITLE_OPTIONS.includes(data.title)) {
    return res.status(400).json({ message: "Please select a valid title." });
  }

  if (!EMAIL_RE.test(data.email)) {
    return res.status(400).json({ message: "Please enter a valid email address." });
  }

  if (!MOBILE_RE.test(data.mobile)) {
    return res.status(400).json({ message: "Please enter a valid 10-digit mobile number." });
  }

  if (!NAME_RE.test(data.firstName) || (data.lastName && !NAME_RE.test(data.lastName))) {
    return res.status(400).json({ message: "Name fields must be letters only, 2-50 characters." });
  }

  if (!ORG_RE.test(data.organisation)) {
    return res.status(400).json({ message: "Organisation name must be between 2 and 150 characters." });
  }

  if (!CITY_RE.test(data.city)) {
    return res.status(400).json({ message: "City must be letters only, 2-100 characters." });
  }

  if (!data.termsAccepted) {
    return res.status(400).json({ message: "Please accept the Terms and Conditions." });
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
      `INSERT INTO speaker_registrations
        (title, first_name, last_name, organisation, designation, email, mobile, address, city, zip_code, state, country, terms_accepted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.title,
        data.firstName,
        data.lastName || null,
        data.organisation,
        data.designation,
        data.email.toLowerCase(),
        data.mobile,
        data.address || null,
        data.city,
        data.zipCode || null,
        data.state || null,
        data.country,
        data.termsAccepted ? 1 : 0
      ]
    );
    res.status(201).json({ message: "Speaker registration submitted successfully." });

    const fields = [
      ["Title", data.title],
      ["First name", data.firstName],
      ["Last name", data.lastName],
      ["Organisation", data.organisation],
      ["Designation", data.designation],
      ["Email", data.email],
      ["Mobile", data.mobile],
      ["Address", data.address],
      ["City", data.city],
      ["Zip code", data.zipCode],
      ["State", data.state],
      ["Country", data.country]
    ].filter(([, value]) => value);

    sendMail({
      to: data.email,
      subject: "Thanks for your speaker registration — Wellness India Expo 2027",
      text:
        `Thanks for registering as a speaker for Wellness India Expo 2027, ${data.firstName}. Here's what you submitted:\n\n` +
        fields.map(([label, value]) => `${label}: ${value}`).join("\n") +
        `\n\nOur Conference Committee will review your submission and get in touch with you.`,
      html:
        `<p>Thanks for registering as a speaker for <strong>Wellness India Expo 2027</strong>, ${escapeHtml(data.firstName)}. Here's what you submitted:</p>` +
        `<table cellpadding="4" cellspacing="0">` +
        fields.map(([label, value]) => `<tr><td><strong>${escapeHtml(label)}</strong></td><td>${escapeHtml(value)}</td></tr>`).join("") +
        `</table>` +
        `<p>Our Conference Committee will review your submission and get in touch with you.</p>`
    });
  } catch (err) {
    console.error("Speaker registration submission failed:", err);
    res.status(500).json({ message: "Could not submit your registration. Please try again later." });
  }
});

module.exports = router;
