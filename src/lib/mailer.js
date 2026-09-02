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
      : undefined,
    // Local Postfix relay presents a self-signed cert for opportunistic STARTTLS;
    // this hop never leaves loopback so there's no MITM risk in trusting it.
    tls: { rejectUnauthorized: false }
  });
  return transporter;
}

// An unconfigured or failing mail send should never block/error the form submission it's
// attached to — every failure mode here
// (unconfigured SMTP, a bad transporter config, a send failure) is caught and logged, never
// thrown, so callers can call this fire-and-forget without a try/catch of their own.
//
// `bcc` recipients are sent as a separate direct email (their address in the `To` header)
// rather than via SMTP-level Bcc: eigroup.in's mail security silently quarantines messages
// where a recipient appears only in the envelope RCPT list and not in a visible To/Cc header,
// so true Bcc copies were never arriving even though the primary `to` copy always did.
async function sendMail({ to, bcc, subject, text, html }) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || '"Wellness India Expo" <noreply@wellnessindiaexpo.com>';
  const client = getTransporter();
  if (!client) {
    console.log(`SMTP not configured — skipping email "${subject}" to ${to}`);
    return;
  }

  try {
    await client.sendMail({ from, to, subject, text, html });
  } catch (err) {
    console.error(`Failed to send email "${subject}" to ${to}:`, err);
  }

  if (bcc && bcc.length > 0) {
    try {
      await client.sendMail({ from, to: bcc, subject, text, html });
    } catch (err) {
      console.error(`Failed to send internal-notification copy of "${subject}" to ${bcc}:`, err);
    }
  }
}

// Sends an OTP code by email (used alongside the SMS gateway when a form sends the same
// code via both channels — otpStore.js's sendBoth()). Best-effort like every other mail
// in this file: an unconfigured SMTP or a send failure never throws, since the mobile/SMS
// side of the OTP delivery already went out (or was attempted) independently.
async function sendOtpEmail(to, code, expiresInSeconds) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || '"Wellness India Expo" <noreply@wellnessindiaexpo.com>';
  const client = getTransporter();
  if (!client) {
    console.log(`SMTP not configured — skipping OTP email to ${to}`);
    return;
  }

  const minutes = Math.round((expiresInSeconds || 600) / 60);
  try {
    await client.sendMail({
      from,
      to,
      subject: "Your Wellness India Expo 2027 verification code",
      text: `Your OTP is ${code}. It is valid for ${minutes} minutes.`,
      html: `<p>Your OTP is <strong style="font-size:18px;letter-spacing:2px;">${code}</strong>.</p><p>It is valid for ${minutes} minutes.</p>`
    });
  } catch (err) {
    console.error(`Failed to send OTP email to ${to}:`, err);
  }
}

// Reads a comma-separated internal-notification list from an env var (e.g.
// BCC_SPACE_BOOKING=princes@eigroup.in,pankaj@eigroup.in) so who gets BCC'd on each form
// can be changed per-environment without a code change or redeploy. Returns [] (meaning "no
// bcc") if the var is unset or blank.
function getBccList(envVarName) {
  return String(process.env[envVarName] || "")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);
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

module.exports = { sendMail, sendOtpEmail, escapeHtml, buildConfirmationEmail, getBccList };
