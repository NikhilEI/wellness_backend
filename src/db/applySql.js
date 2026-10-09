require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

// Usage: npm run db:apply -- migrations/2026-10-09_cms_admin_seo_marketing_source.sql
async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: npm run db:apply -- <path to .sql file>");
    process.exit(1);
  }
  const sql = fs.readFileSync(path.resolve(file), "utf8");
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    multipleStatements: true
  });
  try {
    await connection.query(sql);
    console.log(`Applied ${file}`);
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error("Apply failed:", err.message);
  process.exit(1);
});
