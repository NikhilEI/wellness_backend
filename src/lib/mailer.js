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

// Mirrors the reCAPTCHA pattern in spaceBooking.js: an unconfigured or failing mail send
// should never block/error the form submission it's attached to — every failure mode here
// (unconfigured SMTP, a bad transporter config, a send failure) is caught and logged, never
// thrown, so callers can call this fire-and-forget without a try/catch of their own.
async function sendMail({ to, subject, text, html }) {
  try {
    const client = getTransporter();
    if (!client) {
      console.log(`SMTP not configured — skipping email "${subject}" to ${to}`);
      return;
    }

    await client.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER || '"Wellness India Expo" <noreply@wellnessindiaexpo.com>',
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

// Shared confirmation-email shape used by every marketing-site form (space booking, visitor/
// speaker/media registration, hosted buyer, ...): a personal greeting, a one-line thank-you
// naming what they registered for, then every field they submitted as a label/value table —
// "Event Name" always leads the table so the recipient can tell which form this was.
function buildConfirmationEmail({ firstName, eventName, actionPhrase, fields }) {
  const greeting = `Dear ${firstName},`;
  const intro = `Thank you for your registration as ${actionPhrase} at Wellness India Expo 2027. A senior executive will contact you shortly and we look forward to welcoming you at the expo.`;
  const rows = [["Event Name", eventName], ...fields.filter(([, value]) => value !== undefined && value !== null)];

  const text =
    `${greeting}\n\n${intro}\n\n` + rows.map(([label, value]) => `${label}\t${value}`).join("\n");

  const html =
    `<p>${escapeHtml(greeting)}</p>` +
    `<p>${escapeHtml(intro)}</p>` +
    `<table cellpadding="4" cellspacing="0">` +
    rows.map(([label, value]) => `<tr><td><strong>${escapeHtml(label)}</strong></td><td>${escapeHtml(String(value))}</td></tr>`).join("") +
    `</table>`;

  return { text, html };
}

module.exports = { sendMail, escapeHtml, buildConfirmationEmail };
