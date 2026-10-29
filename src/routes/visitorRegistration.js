const crypto = require("crypto");
const express = require("express");
const QRCode = require("qrcode");
const pool = require("../db/pool");
const otpStore = require("../lib/otpStore");
const { KEY_TRACK_OPTIONS, DESIGNATION_OPTIONS: DESIGNATIONS } = require("../lib/formOptions");
const { checkMaxLengths, COUNTRY_CODE_RE } = require("../lib/validation");
const { sendMail, getBccList } = require("../lib/mailer");
const { buildVisitorEmail } = require("../lib/visitorEmail");

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_RE = /^[A-Za-z][A-Za-z\s'-]{1,99}$/;
const MOBILE_RE = /^[0-9]{6,15}$/;


const VISIT_OBJECTIVES = [
  "Explore New Tech & Solutions",
  "Source Products & Services",
  "Attend Conference Sessions/ Workshops",
  "Network with Industry Leaders & Peers",
  "Investment & Startup Opportunities"
];

const PRODUCT_INTERESTS = [
  "Nutrition, Functional Foods & Beverages",
  "Nutraceuticals & Preventive Health",
  "Longevity, Healthspan & Healthy Ageing",
  "Wellness Tech, Wearables & Diagnostics",
  "Fitness, Recovery & Human Performance",
  "Sleep, Mental Wellbeing & Mindfulness",
  "Beauty, Aesthetics & Personal Care",
  "Women’s Health & Femtech",
  "Spa, Wellness Tourism, Corporate & Healthy Living"
];

const ALREADY_REGISTERED_MESSAGE = "A registration already exists for this email/mobile number.";

// "VIS" + 6 random digits (e.g. VIS416326). The column is UNIQUE, so we check for a clash
// and retry rather than trusting the random draw.
async function generateRegistrationId() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const id = `VIS${crypto.randomInt(100000, 1000000)}`;
    const [rows] = await pool.query("SELECT 1 FROM visitor_registrations WHERE registration_id = ? LIMIT 1", [id]);
    if (rows.length === 0) return id;
  }
  throw new Error("Could not generate a unique registration ID");
}

router.post("/", async (req, res) => {
  const body = req.body || {};

  const data = {
    title: String(body.title || "").trim(),
    firstName: String(body.firstName || "").trim(),
    lastName: String(body.lastName || "").trim(),
    organisation: String(body.organisation || "").trim(),
    designation: String(body.designation || "").trim(),
    department: String(body.department || "").trim(),
    country: String(body.country || "").trim(),
    countryCode: String(body.countryCode || "").trim(),
    state: String(body.state || "").trim(),
    city: String(body.city || "").trim(),
    mobile: String(body.mobile || "").trim(),
    email: String(body.email || "").trim().toLowerCase(),
    keyTrack: String(body.keyTrack || "").trim(),
    visitObjective: String(body.visitObjective || "").trim(),
    productInterests: Array.isArray(body.productInterests) ? body.productInterests.map((v) => String(v)) : [],
    termsAccepted: body.termsAccepted === true,
    marketingConsent: body.marketingConsent === true
  };

  if (!NAME_RE.test(data.firstName)) {
    return res.status(400).json({ message: "Please enter a valid first name (2-100 letters, no numbers)." });
  }
  if (!NAME_RE.test(data.lastName)) {
    return res.status(400).json({ message: "Please enter a valid last name (2-100 letters, no numbers)." });
  }
  if (data.organisation.length > 150) {
    return res.status(400).json({ message: "Organisation name must be under 150 characters." });
  }
  if (!DESIGNATIONS.includes(data.designation)) {
    return res.status(400).json({ message: "Please select a valid designation." });
  }
  if (!data.country) {
    return res.status(400).json({ message: "Please select a country." });
  }
  if (!data.state) {
    return res.status(400).json({ message: "Please select or enter a state." });
  }
  if (data.city.length < 2 || data.city.length > 100) {
    return res.status(400).json({ message: "City must be between 2 and 100 characters." });
  }
  if (!data.countryCode || !MOBILE_RE.test(data.mobile)) {
    return res.status(400).json({ message: "Please enter a valid mobile number." });
  }
  const lengthError = checkMaxLengths(data, {
    department: ["Department", 100],
    state: ["State", 100],
    country: ["Country", 100],
    email: ["Email", 254]
  });
  if (lengthError) {
    return res.status(400).json({ message: lengthError });
  }
  if (data.organisation && data.organisation.length < 2) {
    return res.status(400).json({ message: "Organisation name must be between 2 and 150 characters." });
  }
  if (!COUNTRY_CODE_RE.test(data.countryCode)) {
    return res.status(400).json({ message: "Invalid country code." });
  }

  if (!EMAIL_RE.test(data.email)) {
    return res.status(400).json({ message: "Please enter a valid email address." });
  }
  if (!KEY_TRACK_OPTIONS.includes(data.keyTrack)) {
    return res.status(400).json({ message: "Please select a key track." });
  }
  if (!VISIT_OBJECTIVES.includes(data.visitObjective)) {
    return res.status(400).json({ message: "Please select the objective of your visit." });
  }
  if (data.productInterests.length === 0 || !data.productInterests.every((i) => PRODUCT_INTERESTS.includes(i))) {
    return res.status(400).json({ message: "Please select at least one product interest." });
  }
  if (!data.termsAccepted) {
    return res.status(400).json({ message: "Please confirm that you are 18 years of age or older and accept the Terms & Conditions." });
  }

  // Never trust the client's otpVerified flag — re-check the server-side OTP state that
  // was actually set by a successful /api/otp/verify call for this mobile/email.
  const normalizedMobile = `${data.countryCode}${data.mobile}`;
  const mobileVerified = otpStore.isVerified("mobile", normalizedMobile);
  const emailVerified = otpStore.isVerified("email", data.email);
  if (!mobileVerified && !emailVerified) {
    return res.status(400).json({ message: "Please verify your mobile number or email address via OTP before submitting." });
  }

  try {
    const [existing] = await pool.query(
      "SELECT id FROM visitor_registrations WHERE email = ? OR mobile = ? LIMIT 1",
      [data.email, normalizedMobile]
    );
    if (existing.length > 0) {
      return res.status(409).json({ message: ALREADY_REGISTERED_MESSAGE });
    }

    const registrationId = await generateRegistrationId();

    await pool.query(
      `INSERT INTO visitor_registrations
        (registration_id, title, first_name, last_name, organisation, designation, department,
         country, country_code, state, city, mobile, email, otp_verified_via, visit_objective,
         product_interests, key_track, terms_accepted, marketing_consent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        registrationId,
        data.title,
        data.firstName,
        data.lastName,
        data.organisation || null,
        data.designation,
        data.department || null,
        data.country,
        data.countryCode,
        data.state,
        data.city,
        normalizedMobile,
        data.email,
        mobileVerified ? "mobile" : "email",
        data.visitObjective,
        JSON.stringify(data.productInterests),
        data.keyTrack,
        data.termsAccepted,
        data.marketingConsent
      ]
    );

    const qrCode = await QRCode.toDataURL(registrationId, { width: 300, margin: 1 });
    res.status(201).json({ message: "Registration submitted successfully.", registrationId, qrCode });

    buildVisitorEmail({
      registrationId,
      firstName: data.firstName,
      lastName: data.lastName,
      organisation: data.organisation,
      designation: data.designation,
      department: data.department,
      email: data.email,
      mobile: normalizedMobile,
      city: data.city,
      state: data.state,
      country: data.country,
      keyTrack: data.keyTrack,
      visitObjective: data.visitObjective,
      productInterests: data.productInterests
    })
      .then((mail) => sendMail({ to: data.email, bcc: getBccList("BCC_VISITOR_REGISTRATION"), ...mail }))
      .catch((err) => console.error("Failed to build visitor confirmation email:", err));
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      // Two simultaneous submits for the same email/mobile raced past the SELECT above.
      return res.status(409).json({ message: ALREADY_REGISTERED_MESSAGE });
    }
    console.error("Visitor registration submission failed:", err);
    res.status(500).json({ message: "Something went wrong while completing your registration. Please try again." });
  }
});

module.exports = router;
