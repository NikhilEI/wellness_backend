const express = require("express");
const pool = require("../db/pool");
const otpStore = require("../lib/otpStore");
const { INDUSTRY_OPTIONS, DESIGNATION_OPTIONS } = require("../lib/formOptions");
const { checkMaxLengths } = require("../lib/validation");
const { sendMail, buildConfirmationEmail, getBccList } = require("../lib/mailer");

const { parseMobile } = require("../lib/phone");

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_RE = /^[A-Za-z\s'-]{2,30}$/;
const ORG_RE = /^.{2,100}$/;
const CITY_RE = /^[A-Za-z\s'-]{2,50}$/;

const ALREADY_REGISTERED_MESSAGE = "A booking enquiry already exists for this email/mobile number.";

const LEARN_ABOUT_OPTIONS = [
  "Google",
  "LinkedIn",
  "Facebook",
  "Twitter",
  "Instagram",
  "Emailer",
  "Newspaper Ads",
  "Magazine Ads",
  "Referral from friend / colleague",
  "Whatsapp / SMS",
  "Others"
];

const REQUIRED_FIELDS = [
  "firstName",
  "lastName",
  "organisation",
  "email",
  "learnAboutExpo",
  "city",
  "country",
  "state",
  "mobileNo",
  "industry"
];

// requireOtp=false is used by the internal marketing-team form (POST /marketing), which
// has no OTP step.
const createHandler = ({ requireOtp }) => async (req, res) => {
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

  const lengthError = checkMaxLengths(data, {
    designation: ["Designation", 100],
    shellSpace: ["Space required", 255],
    email: ["Email", 254],
    state: ["State", 100],
    country: ["Country", 100]
  });
  if (lengthError) {
    return res.status(400).json({ message: lengthError });
  }
  if (data.designation && !DESIGNATION_OPTIONS.includes(data.designation)) {
    return res.status(400).json({ message: "Please select a valid designation." });
  }
  if (!LEARN_ABOUT_OPTIONS.includes(data.learnAboutExpo)) {
    return res.status(400).json({ message: "Please select how you heard about the expo." });
  }

  if (!EMAIL_RE.test(data.email)) {
    return res.status(400).json({ message: "Please enter a valid email address." });
  }

  const phone = parseMobile(req.body.countryCode, data.mobileNo);
  if (!phone.ok) {
    return res.status(400).json({ message: phone.message });
  }

  if (!NAME_RE.test(data.firstName) || !NAME_RE.test(data.lastName)) {
    return res.status(400).json({ message: "First and last name must be letters only, 2-30 characters." });
  }

  if (!ORG_RE.test(data.organisation)) {
    return res.status(400).json({ message: "Organisation name must be between 2 and 100 characters." });
  }

  if (!CITY_RE.test(data.city)) {
    return res.status(400).json({ message: "City must be letters only, 2-50 characters." });
  }

  if (!INDUSTRY_OPTIONS.includes(data.industry)) {
    return res.status(400).json({ message: "Please select a valid industry." });
  }

  // Never trust the client's otpVerified flag — re-check the server-side OTP state that
  // was actually set by a successful /api/otp/verify call for this mobile number.
  if (requireOtp && !otpStore.isVerified("mobile", `${phone.countryCode}${phone.mobile}`)) {
    return res.status(400).json({ message: "Please verify your mobile number via OTP before submitting." });
  }
  data.mobileNo = phone.stored;

  try {
    const [existing] = await pool.query("SELECT id FROM space_bookings WHERE email = ? OR mobile_no = ? LIMIT 1", [
      data.email.toLowerCase(),
      data.mobileNo
    ]);
    if (existing.length > 0) {
      return res.status(409).json({ message: ALREADY_REGISTERED_MESSAGE });
    }

    await pool.query(
      `INSERT INTO space_bookings
        (first_name, last_name, organisation, designation, email, learn_about_expo, city, country, state, mobile_no, shell_space, industry, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.firstName,
        data.lastName,
        data.organisation,
        data.designation || null,
        data.email.toLowerCase(),
        data.learnAboutExpo,
        data.city,
        data.country,
        data.state,
        data.mobileNo,
        data.shellSpace || null,
        data.industry,
        requireOtp ? "public" : "marketing"
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
        ["State", data.state],
        ["Space Required", data.shellSpace],
        ["Industry", data.industry],
        ["How did you hear about the expo?", data.learnAboutExpo]
      ]
    });

    sendMail({
      to: data.email,
      bcc: getBccList("BCC_SPACE_BOOKING"),
      subject: "Thanks for your enquiry — Wellness India Expo 2027",
      text,
      html
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: ALREADY_REGISTERED_MESSAGE });
    }
    console.error("Space booking submission failed:", err);
    res.status(500).json({ message: "Could not submit your enquiry. Please try again later." });
  }
};

router.post("/", createHandler({ requireOtp: true }));
router.post("/marketing", createHandler({ requireOtp: false }));

module.exports = router;
