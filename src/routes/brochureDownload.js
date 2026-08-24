const express = require("express");
const pool = require("../db/pool");
const otpStore = require("../lib/otpStore");
const { sendMail, escapeHtml } = require("../lib/mailer");

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_RE = /^[0-9]{6,15}$/;
const BROCHURE_URL = process.env.BROCHURE_URL || "https://wellnessindiaexpo.com/pdf/Wellness-India-2027-Expo-Brochure.pdf";

router.post("/", async (req, res) => {
  const body = req.body || {};

  const data = {
    fullName: String(body.fullName || "").trim(),
    designation: String(body.designation || "").trim(),
    companyName: String(body.companyName || "").trim(),
    industry: String(body.industry || "").trim(),
    interest: String(body.interest || "").trim(),
    email: String(body.email || "").trim().toLowerCase(),
    country: String(body.country || "").trim(),
    countryCode: String(body.countryCode || "").trim(),
    mobile: String(body.mobile || "").trim()
  };

  if (data.fullName.length < 2 || data.fullName.length > 100) {
    return res.status(400).json({ message: "Please enter your full name." });
  }
  if (data.designation.length < 2 || data.designation.length > 100) {
    return res.status(400).json({ message: "Please enter your designation." });
  }
  if (data.companyName.length < 2 || data.companyName.length > 150) {
    return res.status(400).json({ message: "Please enter your company name." });
  }
  if (!data.country) {
    return res.status(400).json({ message: "Please select a country." });
  }
  if (!EMAIL_RE.test(data.email)) {
    return res.status(400).json({ message: "Please enter a valid email address." });
  }
  if (!data.countryCode || !MOBILE_RE.test(data.mobile)) {
    return res.status(400).json({ message: "Please enter a valid mobile number." });
  }

  // Never trust the client's otpVerified flag — re-check the server-side OTP state that
  // was actually set by a successful /api/otp/verify call for this mobile number.
  const normalizedMobile = `${data.countryCode}${data.mobile}`;
  if (!otpStore.isVerified("mobile", normalizedMobile)) {
    return res.status(400).json({ message: "Please verify your mobile number via OTP before submitting." });
  }

  try {
    await pool.query(
      `INSERT INTO brochure_downloads
        (full_name, designation, company_name, industry, interest, email, country, country_code, mobile)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.fullName,
        data.designation,
        data.companyName,
        data.industry || null,
        data.interest || null,
        data.email,
        data.country,
        data.countryCode,
        normalizedMobile
      ]
    );

    res.status(201).json({ message: "Thank you. Your brochure is ready.", brochureUrl: BROCHURE_URL });

    sendMail({
      to: data.email,
      subject: "Your Wellness India Expo 2027 Brochure",
      text:
        `Thanks for your interest in Wellness India Expo 2027, ${data.fullName}.\n\n` +
        `Download the brochure here: ${BROCHURE_URL}`,
      html:
        `<p>Thanks for your interest in <strong>Wellness India Expo 2027</strong>, ${escapeHtml(data.fullName)}.</p>` +
        `<p><a href="${BROCHURE_URL}">Click here to download the brochure</a>.</p>`
    });
  } catch (err) {
    console.error("Brochure download submission failed:", err);
    res.status(500).json({ message: "Something went wrong. Please try again." });
  }
});

module.exports = router;
