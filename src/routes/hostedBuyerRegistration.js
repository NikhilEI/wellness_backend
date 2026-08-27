const express = require("express");
const pool = require("../db/pool");
const { sendMail, buildConfirmationEmail } = require("../lib/mailer");

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_RE = /^[0-9]{10}$/;
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
  data.termsAccepted = Boolean(req.body.termsAccepted);
  data.recaptchaToken = String(req.body.recaptchaToken || "").trim();

  const missing = REQUIRED_FIELDS.filter((key) => !data[key]);
  if (missing.length > 0) {
    return res.status(400).json({ message: "Please fill in all required fields." });
  }

  if (!NAME_RE.test(data.fullName)) {
    return res.status(400).json({ message: "Full name must be letters only, 2-100 characters." });
  }

  if (!EMAIL_RE.test(data.email)) {
    return res.status(400).json({ message: "Please enter a valid email address." });
  }

  if (!MOBILE_RE.test(data.mobile)) {
    return res.status(400).json({ message: "Please enter a valid 10-digit mobile number." });
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
