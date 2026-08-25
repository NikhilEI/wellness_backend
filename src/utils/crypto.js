const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("ENCRYPTION_KEY is not set — required to read/write encrypted PII columns (gst_number_enc, pan_number_enc, etc.).");
  }
  const key = Buffer.from(raw, "hex");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be a 64-character hex string (32 bytes) for AES-256-GCM.");
  }
  return key;
}

// Encrypts `plainText` for storage in an `_enc` column. Output packs
// iv + authTag + ciphertext into one base64 string so the column stays a single value.
function encrypt(plainText) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plainText), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

function decrypt(encoded) {
  const packed = Buffer.from(encoded, "base64");
  const iv = packed.subarray(0, IV_LENGTH);
  const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = packed.subarray(IV_LENGTH + 16);
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

function encryptNullable(plainText) {
  if (plainText === null || plainText === undefined || plainText === "") return null;
  return encrypt(plainText);
}

function decryptNullable(encoded) {
  if (encoded === null || encoded === undefined) return null;
  return decrypt(encoded);
}

// Opaque session/reset tokens: a random value is sent to the client (cookie or
// emailed link); only its SHA-256 hash is ever stored, so a DB read can't leak
// usable tokens.
function generateSecureToken(bytes = 48) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

module.exports = { encrypt, decrypt, encryptNullable, decryptNullable, generateSecureToken, hashToken };
