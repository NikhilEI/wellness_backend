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

async function send(channel, identifier, ip) {
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

module.exports = { send, verify, isVerified };
