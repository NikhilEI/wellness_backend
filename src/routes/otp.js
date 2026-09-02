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

  // "both" sends one code through mobile (SMS) and email at once — used by forms that
  // require both fields, so the user gets the code via whichever channel arrives first.
  if (channel === "both") {
    const countryCode = String(req.body.countryCode || "").trim();
    const mobile = String(req.body.mobile || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!countryCode || !MOBILE_RE.test(mobile)) return null;
    if (!EMAIL_RE.test(email)) return null;
    return { channel, mobile: `${countryCode}${mobile}`, email };
  }

  return null;
}

router.post("/send", async (req, res) => {
  const resolved = resolveIdentifier(req);
  if (!resolved) {
    return res.status(400).json({ message: "Please provide a valid mobile number and email address." });
  }

  const result =
    resolved.channel === "both"
      ? await otpStore.sendBoth(resolved.mobile, resolved.email, req.ip)
      : await otpStore.send(resolved.channel, resolved.identifier, req.ip);

  if (!result.ok) {
    if (result.reason === "send_failed") {
      return res.status(502).json({ message: "Could not send OTP right now. Please try again." });
    }
    if (result.reason === "cooldown") {
      return res.status(429).json({ message: `Please wait ${result.waitSeconds} seconds before requesting another OTP.` });
    }
    return res.status(429).json({ message: "Too many OTP requests. Please try again later." });
  }

  const message = resolved.channel === "both" ? "OTP sent successfully via Email and WhatsApp." : "OTP sent successfully.";
  res.json({ message, expiresInSeconds: result.expiresInSeconds });
});

router.post("/verify", (req, res) => {
  const resolved = resolveIdentifier(req);
  const otp = String(req.body.otp || "").trim();

  if (!resolved || !OTP_RE.test(otp)) {
    return res.status(400).json({ message: "Invalid or expired OTP." });
  }

  const result =
    resolved.channel === "both"
      ? otpStore.verifyBoth(resolved.mobile, resolved.email, otp)
      : otpStore.verify(resolved.channel, resolved.identifier, otp);

  if (!result.ok) {
    return res.status(400).json({ message: "Invalid or expired OTP." });
  }

  res.json({ message: "OTP verified successfully." });
});

module.exports = router;
