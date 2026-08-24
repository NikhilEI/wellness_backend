const express = require("express");
const otpStore = require("../lib/otpStore");

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_RE = /^[0-9]{6,15}$/;
const OTP_RE = /^[0-9]{4,6}$/;

function resolveIdentifier(req) {
  const channel = String(req.body.channel || "").trim().toLowerCase();

  if (channel === "mobile") {
    const countryCode = String(req.body.countryCode || "").trim();
    const mobile = String(req.body.mobile || "").trim();
    if (!countryCode || !MOBILE_RE.test(mobile)) return null;
    return { channel, identifier: `${countryCode}${mobile}` };
  }

  if (channel === "email") {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return null;
    return { channel, identifier: email };
  }

  return null;
}

router.post("/send", (req, res) => {
  const resolved = resolveIdentifier(req);
  if (!resolved) {
    return res.status(400).json({ message: "Please provide a valid mobile number or email address." });
  }

  const result = otpStore.send(resolved.channel, resolved.identifier, req.ip);
  if (!result.ok) {
    return res.status(429).json({ message: "Too many OTP requests. Please try again later." });
  }

  res.json({ message: "OTP sent successfully.", expiresInSeconds: result.expiresInSeconds });
});

router.post("/verify", (req, res) => {
  const resolved = resolveIdentifier(req);
  const otp = String(req.body.otp || "").trim();

  if (!resolved || !OTP_RE.test(otp)) {
    return res.status(400).json({ message: "Invalid or expired OTP." });
  }

  const result = otpStore.verify(resolved.channel, resolved.identifier, otp);
  if (!result.ok) {
    return res.status(400).json({ message: "Invalid or expired OTP." });
  }

  res.json({ message: "OTP verified successfully." });
});

module.exports = router;
