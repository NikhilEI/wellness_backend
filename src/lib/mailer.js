const nodemailer = require("nodemailer");

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST) return null;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined
  });
  return transporter;
}

// Mirrors the reCAPTCHA pattern in spaceBooking.js: an unconfigured integration should
// never block the form submission it's attached to, just skip silently (with a log line).
async function sendMail({ to, subject, text, html }) {
  const client = getTransporter();
  if (!client) {
    console.log(`SMTP not configured — skipping email "${subject}" to ${to}`);
    return;
  }

  try {
    await client.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      text,
      html
    });
  } catch (err) {
    console.error(`Failed to send email "${subject}" to ${to}:`, err);
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

module.exports = { sendMail, escapeHtml };
