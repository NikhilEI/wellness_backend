const express = require("express");
const pool = require("../db/pool");
const otpStore = require("../lib/otpStore");
const { DESIGNATION_OPTIONS } = require("../lib/formOptions");
const { checkMaxLengths } = require("../lib/validation");
const { sendMail, buildConfirmationEmail, getBccList } = require("../lib/mailer");

const { parseMobile } = require("../lib/phone");

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_RE = /^[A-Za-z\s'-]{2,100}$/;
const CITY_RE = /^[A-Za-z\s'-]{2,100}$/;
const WEBSITE_RE = /^[^\s]+\.[a-zA-Z]{2,}([^\s]*)?$/;

const REQUIRED_FIELDS = [
  "fullName",
  "designation",
  "company",
  "email",
  "mobile",
  "city",
  "country",
  "website",
  "outlets",
  "companyTurnover",
  "companyProfile"
];

router.post("/", async (req, res) => {
  const data = {};
  for (const key of REQUIRED_FIELDS) {
    data[key] = String(req.body[key] || "").trim();
  }
  data.termsAccepted = Boolean(req.body.termsAccepted);

  const missing = REQUIRED_FIELDS.filter((key) => !data[key]);
  if (missing.length > 0) {
    return res.status(400).json({ message: "Please fill in all required fields." });
  }

  if (!NAME_RE.test(data.fullName)) {
    return res.status(400).json({ message: "Full name must be letters only, 2-100 characters." });
  }

  const lengthError = checkMaxLengths(data, {
    designation: ["Designation", 100],
    company: ["Company", 150],
    country: ["Country", 100],
    website: ["Website", 255],
    outlets: ["No. of outlets", 100],
    companyTurnover: ["Company turnover", 100],
    email: ["Email", 254]
  });
  if (lengthError) {
    return res.status(400).json({ message: lengthError });
  }

  if (!DESIGNATION_OPTIONS.includes(data.designation)) {
    return res.status(400).json({ message: "Please select a valid designation." });
  }

  if (!EMAIL_RE.test(data.email)) {
    return res.status(400).json({ message: "Please enter a valid email address." });
  }

  const phone = parseMobile(req.body.countryCode, data.mobile);
  if (!phone.ok) {
    return res.status(400).json({ message: phone.message });
  }

  if (!CITY_RE.test(data.city)) {
    return res.status(400).json({ message: "City must be letters only, 2-100 characters." });
  }

  if (!WEBSITE_RE.test(data.website)) {
    return res.status(400).json({ message: "Please enter a valid website." });
  }

  if (data.companyProfile.length > 400) {
    return res.status(400).json({ message: "Company Profile must be 400 characters or fewer." });
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
    await pool.query(
      `INSERT INTO hosted_buyer_registrations
        (full_name, designation, company, email, mobile, city, country, website, outlets, company_turnover, company_profile, terms_accepted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.fullName,
        data.designation,
        data.company,
        data.email.toLowerCase(),
        data.mobile,
        data.city,
        data.country,
        data.website,
        data.outlets,
        data.companyTurnover,
        data.companyProfile,
        data.termsAccepted ? 1 : 0
      ]
    );
    res.status(201).json({ message: "Hosted Buyer registration submitted successfully." });

    const { text, html } = buildConfirmationEmail({
      firstName: data.fullName.split(" ")[0],
      eventName: "Wellness India Expo 2027 - Hosted Buyer Programme",
      actionPhrase: "a hosted buyer",
      fields: [
        ["Full Name", data.fullName],
        ["Designation", data.designation],
        ["Company", data.company],
        ["Email", data.email],
        ["Mobile No", data.mobile],
        ["City", data.city],
        ["Country", data.country],
        ["Website", data.website],
        ["No. of Outlets / Channel Partners", data.outlets],
        ["Company Turnover", data.companyTurnover],
        ["Company Profile", data.companyProfile]
      ]
    });

    sendMail({
      to: data.email,
      bcc: getBccList("BCC_HOSTED_BUYER"),
      subject: "Thanks for your Hosted Buyer enquiry — Wellness India Expo 2027",
      text,
      html
    });
  } catch (err) {
    console.error("Hosted Buyer registration submission failed:", err);
    res.status(500).json({ message: "Could not submit your registration. Please try again later." });
  }
});

module.exports = router;
