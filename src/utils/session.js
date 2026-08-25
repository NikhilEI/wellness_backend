const { generateSecureToken, hashToken } = require("./crypto");

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME || "ez_session";
const TTL_DAYS = Number(process.env.SESSION_TTL_DAYS) || 7;

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: TTL_DAYS * 24 * 60 * 60 * 1000,
    path: "/"
  };
}

async function createSession(pool, { userId, eventId, ipAddress, userAgent }) {
  const token = generateSecureToken(48);
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000);

  await pool.query(
    `INSERT INTO sessions (token_hash, user_id, event_id, ip_address, user_agent, expires_at, last_activity, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [tokenHash, userId, eventId || null, ipAddress || null, (userAgent || "").slice(0, 512), expiresAt]
  );

  return { token, expiresAt };
}

async function destroySession(pool, token) {
  if (!token) return;
  await pool.query("DELETE FROM sessions WHERE token_hash = ?", [hashToken(token)]);
}

async function destroyOtherSessions(pool, userId, keepToken) {
  const keepHash = keepToken ? hashToken(keepToken) : null;
  if (keepHash) {
    await pool.query("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?", [userId, keepHash]);
  } else {
    await pool.query("DELETE FROM sessions WHERE user_id = ?", [userId]);
  }
}

module.exports = { COOKIE_NAME, cookieOptions, createSession, destroySession, destroyOtherSessions };
