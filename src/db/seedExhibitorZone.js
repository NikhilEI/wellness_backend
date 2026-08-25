require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const argon2 = require("@node-rs/argon2");

const SEED_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || "admin@exhibitorzone.com";
const SEED_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "ChangeMe123!";

// OWASP-recommended Argon2id params, matching src/utils/argon.js.
const ARGON2_OPTIONS = { algorithm: argon2.Algorithm.Argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4 };

async function seed() {
  const seedSql = fs.readFileSync(path.join(__dirname, "..", "..", "exhibitor-zone", "seed.sql"), "utf8");

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "wellness_india_expo",
    multipleStatements: true
  });

  try {
    await connection.query(seedSql);
    console.log("Exhibitor Zone reference data (event-role grant, form templates, catalogue) seeded.");

    // The pre-existing seed row for the admin user ships with an intentionally
    // inert placeholder password hash. Reset it to a known, real Argon2id hash
    // so the system is actually usable end-to-end out of the box.
    const passwordHash = await argon2.hash(SEED_ADMIN_PASSWORD, ARGON2_OPTIONS);
    const [result] = await connection.query("UPDATE users SET password_hash = ? WHERE email = ?", [
      passwordHash,
      SEED_ADMIN_EMAIL
    ]);

    if (result.affectedRows === 0) {
      console.log(`No user found with email ${SEED_ADMIN_EMAIL} — skipping password reset.`);
      return;
    }

    console.log("Seeded super_admin login:");
    console.log(`  email:    ${SEED_ADMIN_EMAIL}`);
    console.log(`  password: ${SEED_ADMIN_PASSWORD}`);
    console.log("  (override via SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD env vars before seeding)");
  } finally {
    await connection.end();
  }
}

seed().catch((err) => {
  console.error("Exhibitor Zone seed failed:", err.message);
  process.exit(1);
});
