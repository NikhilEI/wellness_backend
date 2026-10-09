require("dotenv").config();
const pool = require("./pool");
const { hashPassword } = require("../utils/argon");

// Usage: npm run cms:create-admin -- "admin@example.com" "StrongPassword" "Display Name"
// Re-running with an existing email resets that admin's password.
async function main() {
  const [email, password, name] = process.argv.slice(2);
  if (!email || !password) {
    console.error('Usage: npm run cms:create-admin -- <email> <password> ["Display Name"]');
    process.exit(1);
  }
  if (password.length < 10) {
    console.error("Password must be at least 10 characters.");
    process.exit(1);
  }
  const hash = await hashPassword(password);
  await pool.query(
    `INSERT INTO cms_admins (email, name, password_hash) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), name = VALUES(name), is_active = 1`,
    [email.trim().toLowerCase(), name || email.split("@")[0], hash]
  );
  console.log(`CMS admin ready: ${email}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
