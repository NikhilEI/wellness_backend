const argon2 = require("@node-rs/argon2");

// OWASP-recommended params — matches the hash already seeded on the admin user
// ($argon2id$v=19$m=65536,t=3,p=4$...), so existing and newly-created hashes verify identically.
const OPTIONS = { algorithm: argon2.Algorithm.Argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4 };

function hashPassword(plain) {
  return argon2.hash(plain, OPTIONS);
}

function verifyPassword(hash, plain) {
  return argon2.verify(hash, plain);
}

// True if `hash` wasn't produced with today's OPTIONS (e.g. params were tightened) —
// callers should re-hash and save on the next successful login.
function needsRehash(hash) {
  return (
    !hash.includes(`m=${OPTIONS.memoryCost}`) ||
    !hash.includes(`t=${OPTIONS.timeCost}`) ||
    !hash.includes(`p=${OPTIONS.parallelism}`) ||
    !hash.startsWith("$argon2id$")
  );
}

module.exports = { hashPassword, verifyPassword, needsRehash };
