const express = require("express");
const pool = require("../db/pool");
const otpStore = require("../lib/otpStore");
const { sendMail, buildConfirmationEmail, getBccList } = require("../lib/mailer");

// This form only ever collects a 10-digit Indian mobile number (no country selector),
// so the OTP identifier is always prefixed with India's dial code.
const OTP_COUNTRY_CODE = "+91";

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_RE = /^[0-9]{10}$/;
const NAME_RE = /^[A-Za-z\s'-]{2,50}$/;
const CITY_RE = /^[A-Za-z\s'-]{2,100}$/;

const REQUIRED_FIELDS = ["mediaName", "fullName", "designation", "email", "city", "country", "mobile"];

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
  data.pressCardNo = String(req.body.pressCardNo || "").trim();
  data.termsAccepted = Boolean(req.body.termsAccepted);
  data.recaptchaToken = String(req.body.recaptchaToken || "").trim();

  const missing = REQUIRED_FIELDS.filter((key) => !data[key]);
  if (missing.length > 0) {
    return res.status(400).json({ message: "Please fill in all required fields." });
  }

  if (!EMAIL_RE.test(data.email)) {
    return res.status(400).json({ message: "Please enter a valid email address." });
  }

  if (!MOBILE_RE.test(data.mobile)) {
    return res.status(400).json({ message: "Please enter a valid 10-digit mobile number." });
  }

  if (!NAME_RE.test(data.fullName)) {
    return res.status(400).json({ message: "Full name must be letters only, 2-50 characters." });
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

  // Never trust the client's otpVerified flag — re-check the server-side OTP state that
  // was actually set by a successful /api/otp/verify call for this mobile number.
  if (!otpStore.isVerified("mobile", `${OTP_COUNTRY_CODE}${data.mobile}`)) {
    return res.status(400).json({ message: "Please verify your mobile number via OTP before submitting." });
  }

  try {
    await pool.query(
      `INSERT INTO media_registrations
        (media_name, press_card_no, full_name, designation, email, city, country, mobile, terms_accepted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.mediaName,
        data.pressCardNo || null,
        data.fullName,
        data.designation,
        data.email.toLowerCase(),
        data.city,
        data.country,
        data.mobile,
        data.termsAccepted ? 1 : 0
      ]
    );
    res.status(201).json({ message: "Media registration submitted successfully." });

    const { text, html } = buildConfirmationEmail({
      firstName: data.fullName.split(" ")[0],
      eventName: "Wellness India Expo 2027 - Media Registration",
      actionPhrase: "media",
      fields: [
        ["Name of Media", data.mediaName],
        ["Press Card No", data.pressCardNo],
        ["Full Name", data.fullName],
        ["Designation", data.designation],
        ["Email", data.email],
        ["Mobile No", data.mobile],
        ["City", data.city],
        ["Country", data.country]
      ]
    });

    sendMail({
      to: data.email,
      bcc: getBccList("BCC_MEDIA_REGISTRATION"),
      subject: "Thanks for your media registration — Wellness India Expo 2027",
      text,
      html
    });
  } catch (err) {
    console.error("Media registration submission failed:", err);
    res.status(500).json({ message: "Could not submit your registration. Please try again later." });
  }
});

module.exports = router;
