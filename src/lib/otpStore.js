// In-memory OTP store. Every code is the fixed OTP_MOCK_CODE until a real SMS/email
// gateway is wired up — this module already enforces expiry, resend rate limiting and
// verify-attempt limiting so swapping in a real gateway later only means replacing how
// the code is delivered, not this state machine.
const MOCK_CODE = process.env.OTP_MOCK_CODE || "1234";
const TTL_MS = (Number(process.env.OTP_TTL_MINUTES) || 10) * 60 * 1000;
const SEND_WINDOW_MS = (Number(process.env.OTP_SEND_WINDOW_MINUTES) || 15) * 60 * 1000;
const MAX_SENDS_PER_WINDOW = Number(process.env.OTP_MAX_SENDS) || 5;
const MAX_VERIFY_ATTEMPTS = Number(process.env.OTP_MAX_VERIFY_ATTEMPTS) || 5;

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

function send(channel, identifier, ip) {
  if (!checkRateLimit(channel, identifier, ip)) {
    return { ok: false, reason: "rate_limited" };
  }
  recordSend(channel, identifier, ip);

  const k = key(channel, identifier);
  otps.set(k, {
    code: MOCK_CODE,
    expiresAt: Date.now() + TTL_MS,
    verified: false,
    attempts: 0
  });

  console.log(`OTP for ${k}: ${MOCK_CODE} (mock — no gateway configured yet)`);
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
