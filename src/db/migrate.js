require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, "..", "..", "schema.sql"), "utf8");

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    multipleStatements: true
  });

  try {
    await connection.query(sql);
    console.log("Database and tables are up to date.");
  } finally {
    await connection.end();
  }
}

migrate().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
