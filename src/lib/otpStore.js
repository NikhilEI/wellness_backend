// In-memory OTP store. The "mobile" channel sends through the send2.digital SMS gateway
// when SEND2DIGITAL_USER/PASSWORD are configured; every other case (email — no gateway
// wired up yet, or mobile with no gateway configured) falls back to the fixed OTP_MOCK_CODE.
// This module enforces expiry, resend rate limiting and verify-attempt limiting regardless
// of which path generated the code.
const MOCK_CODE = process.env.OTP_MOCK_CODE || "1234";
const TTL_MS = (Number(process.env.OTP_TTL_MINUTES) || 10) * 60 * 1000;
const SEND_WINDOW_MS = (Number(process.env.OTP_SEND_WINDOW_MINUTES) || 15) * 60 * 1000;
const MAX_SENDS_PER_WINDOW = Number(process.env.OTP_MAX_SENDS) || 5;
const MAX_VERIFY_ATTEMPTS = Number(process.env.OTP_MAX_VERIFY_ATTEMPTS) || 5;
// Minimum gap between two OTP sends to the same mobile/email, regardless of the
// MAX_SENDS_PER_WINDOW quota above — stops someone spamming "Resend OTP" instantly.
const RESEND_COOLDOWN_MS = (Number(process.env.OTP_RESEND_COOLDOWN_SECONDS) || 120) * 1000;

const { sendOtpEmail } = require("./mailer");

const SEND2DIGITAL_API_URL = "https://api.send2.digital/devdesk/send";
const SEND2DIGITAL_USER = process.env.SEND2DIGITAL_USER;
const SEND2DIGITAL_PASSWORD = process.env.SEND2DIGITAL_PASSWORD;
const SEND2DIGITAL_TEMPLATE = process.env.SEND2DIGITAL_TEMPLATE || "otp_web";

function generateOtp(length = 6) {
  const digits = "0123456789";
  let otp = "";
  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * digits.length)];
  }
  return otp;
}

// `mobileNumber` must already be the full number with country code, digits only
// (e.g. "917982567755") — no leading "+".
async function sendSms(mobileNumber, code) {
  const response = await fetch(SEND2DIGITAL_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_name: SEND2DIGITAL_USER,
      password: SEND2DIGITAL_PASSWORD,
      template_name: SEND2DIGITAL_TEMPLATE,
      number: mobileNumber,
      media_type: "none",
      variable: code
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`send2.digital returned ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

const otps = new Map(); // key -> { code, expiresAt, verified, attempts }
const sendLog = new Map(); // key -> [timestamps]

function key(channel, identifier) {
  return `${channel}:${identifier}`;
}

function pruneSendLog(logKey) {
  const now = Date.now();
  const timestamps = (sendLog.get(logKey) || []).filter((ts) => now - ts < SEND_WINDOW_MS);
  sendLog.set(logKey, timestamps);
  return timestamps;
}

function checkRateLimit(channel, identifier, ip) {
  for (const logKey of [key(channel, identifier), `ip:${ip}`]) {
    const timestamps = pruneSendLog(logKey);
    if (timestamps.length >= MAX_SENDS_PER_WINDOW) {
      return false;
    }
  }
  return true;
}

function recordSend(channel, identifier, ip) {
  const now = Date.now();
  for (const logKey of [key(channel, identifier), `ip:${ip}`]) {
    const timestamps = pruneSendLog(logKey);
    timestamps.push(now);
    sendLog.set(logKey, timestamps);
  }
}

// Rate-limit + cooldown gate shared by send() and sendBoth() — returns a failure result
// to return as-is, or null when it's fine to proceed (and the send has been recorded).
function checkAndRecordSend(channel, identifier, ip) {
  if (!checkRateLimit(channel, identifier, ip)) {
    return { ok: false, reason: "rate_limited" };
  }

  const identifierTimestamps = pruneSendLog(key(channel, identifier));
  const lastSentAt = identifierTimestamps[identifierTimestamps.length - 1];
  if (lastSentAt && Date.now() - lastSentAt < RESEND_COOLDOWN_MS) {
    const waitSeconds = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - lastSentAt)) / 1000);
    return { ok: false, reason: "cooldown", waitSeconds };
  }

  recordSend(channel, identifier, ip);
  return null;
}

async function send(channel, identifier, ip) {
  const blocked = checkAndRecordSend(channel, identifier, ip);
  if (blocked) return blocked;

  const k = key(channel, identifier);
  const gatewayConfigured = channel === "mobile" && SEND2DIGITAL_USER && SEND2DIGITAL_PASSWORD;
  const code = gatewayConfigured ? generateOtp() : MOCK_CODE;

  if (gatewayConfigured) {
    try {
      // identifier is "<countryCode><mobile>" (e.g. "+917982567755") — strip the "+"
      // send2.digital expects digits only.
      await sendSms(identifier.replace(/\D/g, ""), code);
    } catch (err) {
      console.error(`send2.digital OTP send failed for ${k}:`, err.message);
      return { ok: false, reason: "send_failed" };
    }
  } else {
    console.log(`OTP for ${k}: ${code} (mock — no SMS gateway configured for this channel)`);
  }

  otps.set(k, {
    code,
    expiresAt: Date.now() + TTL_MS,
    verified: false,
    attempts: 0
  });

  return { ok: true, expiresInSeconds: Math.floor(TTL_MS / 1000) };
}

function verify(channel, identifier, code) {
  const k = key(channel, identifier);
  const entry = otps.get(k);

  if (!entry) return { ok: false, reason: "not_sent" };
  if (entry.attempts >= MAX_VERIFY_ATTEMPTS) return { ok: false, reason: "too_many_attempts" };
  if (Date.now() > entry.expiresAt) return { ok: false, reason: "expired" };

  entry.attempts += 1;

  if (String(code) !== entry.code) {
    return { ok: false, reason: "mismatch" };
  }

  entry.verified = true;
  return { ok: true };
}

function isVerified(channel, identifier) {
  const entry = otps.get(key(channel, identifier));
  return Boolean(entry && entry.verified && Date.now() <= entry.expiresAt);
}

// Sends ONE code through both channels at once (SMS + email) so the user can use whichever
// arrives first — used by forms that require both a mobile number and an email address.
// Rate limiting / cooldown is gated on the mobile+email pair together, separately from the
// single-channel send() above (so it never interferes with Visitor Registration's
// independent mobile-only / email-only flow).
async function sendBoth(mobileIdentifier, emailIdentifier, ip) {
  const comboKey = `${mobileIdentifier}|${emailIdentifier}`;
  const blocked = checkAndRecordSend("both", comboKey, ip);
  if (blocked) return blocked;

  const gatewayConfigured = SEND2DIGITAL_USER && SEND2DIGITAL_PASSWORD;
  const code = gatewayConfigured ? generateOtp() : MOCK_CODE;

  if (gatewayConfigured) {
    try {
      // mobileIdentifier is "<countryCode><mobile>" (e.g. "+917982567755") — strip the "+"
      // send2.digital expects digits only.
      await sendSms(mobileIdentifier.replace(/\D/g, ""), code);
    } catch (err) {
      console.error(`send2.digital OTP send failed for ${mobileIdentifier}:`, err.message);
      return { ok: false, reason: "send_failed" };
    }
  } else {
    console.log(`OTP for mobile:${mobileIdentifier} / email:${emailIdentifier}: ${code} (mock — no SMS gateway configured)`);
  }

  const expiresAt = Date.now() + TTL_MS;
  otps.set(key("mobile", mobileIdentifier), { code, expiresAt, verified: false, attempts: 0 });
  otps.set(key("email", emailIdentifier), { code, expiresAt, verified: false, attempts: 0 });

  // Best-effort, same as every other email in this codebase — the SMS side above is the
  // one that can actually fail this request; a slow/broken mailer never blocks OTP delivery.
  sendOtpEmail(emailIdentifier, code, Math.floor(TTL_MS / 1000)).catch(() => {});

  return { ok: true, expiresInSeconds: Math.floor(TTL_MS / 1000) };
}

// The mobile and email entries created by sendBoth() carry the same code, so verifying
// against the mobile entry is sufficient — every form's backend check is
// otpStore.isVerified("mobile", ...). The email entry is marked verified too in case
// anything ever checks that side instead.
function verifyBoth(mobileIdentifier, emailIdentifier, code) {
  const result = verify("mobile", mobileIdentifier, code);
  if (result.ok) {
    const emailEntry = otps.get(key("email", emailIdentifier));
    if (emailEntry) emailEntry.verified = true;
  }
  return result;
}

module.exports = { send, verify, isVerified, sendBoth, verifyBoth };
