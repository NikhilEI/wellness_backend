const express = require("express");
const pool = require("../db/pool");
const otpStore = require("../lib/otpStore");
const { INDUSTRY_OPTIONS, KEY_TRACK_OPTIONS } = require("../lib/formOptions");
const { checkMaxLengths, ZIP_RE } = require("../lib/validation");
const { sendMail, buildConfirmationEmail, getBccList } = require("../lib/mailer");

const { parseMobile } = require("../lib/phone");

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_RE = /^[A-Za-z\s'-]{2,50}$/;
const ORG_RE = /^.{2,150}$/;
const CITY_RE = /^[A-Za-z\s'-]{2,100}$/;
const TITLE_OPTIONS = ["Mr.", "Mrs.", "Miss", "Ms.", "Dr.", "Prof.", "Other"];

const ALREADY_REGISTERED_MESSAGE = "A registration already exists for this email/mobile number.";

const REQUIRED_FIELDS = ["industry", "keyTrack", "title", "firstName", "organisation", "designation", "email", "mobile", "city", "state", "country"];

router.post("/", async (req, res) => {
  const data = {};
  for (const key of REQUIRED_FIELDS) {
    data[key] = String(req.body[key] || "").trim();
  }
  data.lastName = String(req.body.lastName || "").trim();
  data.address = String(req.body.address || "").trim();
  data.zipCode = String(req.body.zipCode || "").trim();
  data.termsAccepted = Boolean(req.body.termsAccepted);

  const missing = REQUIRED_FIELDS.filter((key) => !data[key]);
  if (missing.length > 0) {
    return res.status(400).json({ message: "Please fill in all required fields." });
  }

  if (!TITLE_OPTIONS.includes(data.title)) {
    return res.status(400).json({ message: "Please select a valid title." });
  }

  if (!INDUSTRY_OPTIONS.includes(data.industry)) {
    return res.status(400).json({ message: "Please select a valid industry." });
  }

  if (!KEY_TRACK_OPTIONS.includes(data.keyTrack)) {
    return res.status(400).json({ message: "Please select a valid key track." });
  }

  const lengthError = checkMaxLengths(data, {
    designation: ["Designation", 100],
    address: ["Address", 255],
    state: ["State", 100],
    country: ["Country", 100],
    email: ["Email", 254]
  });
  if (lengthError) {
    return res.status(400).json({ message: lengthError });
  }
  if (data.zipCode && !ZIP_RE.test(data.zipCode)) {
    return res.status(400).json({ message: "Please enter a valid zip code (letters, numbers, spaces or hyphens, up to 20 characters)." });
  }

  if (!EMAIL_RE.test(data.email)) {
    return res.status(400).json({ message: "Please enter a valid email address." });
  }

  const phone = parseMobile(req.body.countryCode, data.mobile);
  if (!phone.ok) {
    return res.status(400).json({ message: phone.message });
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

  // Never trust the client's otpVerified flag — re-check the server-side OTP state that
  // was actually set by a successful /api/otp/verify call for this mobile number.
  if (!otpStore.isVerified("mobile", `${phone.countryCode}${phone.mobile}`)) {
    return res.status(400).json({ message: "Please verify your mobile number via OTP before submitting." });
  }
  data.mobile = phone.stored;

  try {
    const [existing] = await pool.query("SELECT id FROM speaker_registrations WHERE email = ? OR mobile = ? LIMIT 1", [
      data.email.toLowerCase(),
      data.mobile
    ]);
    if (existing.length > 0) {
      return res.status(409).json({ message: ALREADY_REGISTERED_MESSAGE });
    }

    await pool.query(
      `INSERT INTO speaker_registrations
        (title, first_name, last_name, organisation, designation, email, mobile, address, city, zip_code, state, country, industry, key_track, terms_accepted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        data.industry,
        data.keyTrack,
        data.termsAccepted ? 1 : 0
      ]
    );
    res.status(201).json({ message: "Speaker registration submitted successfully." });

    const { text, html } = buildConfirmationEmail({
      firstName: data.firstName,
      eventName: "Wellness India Expo 2027 - Speaker Registration",
      actionPhrase: "a speaker",
      fields: [
        ["Title", data.title],
        ["Full Name", data.firstName],
        ["Last Name", data.lastName],
        ["Organisation", data.organisation],
        ["Designation", data.designation],
        ["Email", data.email],
        ["Mobile No", data.mobile],
        ["Address", data.address],
        ["City", data.city],
        ["Zip Code", data.zipCode],
        ["State", data.state],
        ["Country", data.country],
        ["Industry", data.industry],
        ["Key Track", data.keyTrack]
      ]
    });

    sendMail({
      to: data.email,
      bcc: getBccList("BCC_SPEAKER_REGISTRATION"),
      subject: "Thanks for your speaker registration — Wellness India Expo 2027",
      text,
      html
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: ALREADY_REGISTERED_MESSAGE });
    }
    console.error("Speaker registration submission failed:", err);
    res.status(500).json({ message: "Could not submit your registration. Please try again later." });
  }
});

module.exports = router;
