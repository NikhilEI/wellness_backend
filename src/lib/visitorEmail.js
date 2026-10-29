const QRCode = require("qrcode");
const { escapeHtml } = require("./mailer");

const EXPO_NAME = "Wellness India 2027";
const VENUE = "Bharat Mandapam, New Delhi";
const VENUE_URL = "https://eiexpolive.com/venue/";
const VALID_DATES = "27-29 May 2027";

const NOTES = [
  "Please carry a print out or show a digital copy of this QR Code at the pre-register kiosks at the venue to collect your badge.",
  "Entry allowed only for Trade Visitors above 18 years of age.",
  "Student entry is permitted only on Day 3 from 12:00 PM onward.",
  "For security reasons the pass is non-transferable.",
  "Please carry a valid Photo ID proof."
];

// Builds the visitor "Thank you for your registration" email (badge QR + details table).
// Every value comes from the submitted registration; rows with no value are left out.
// The QR (encoding the registration ID) is attached inline via cid so it shows without
// the recipient having to "load remote images".
async function buildVisitorEmail({
  registrationId,
  firstName,
  lastName,
  organisation,
  designation,
  department,
  email,
  mobile,
  city,
  state,
  country,
  keyTrack,
  visitObjective,
  productInterests,
  status = "Visitor"
}) {
  const eventName = `${EXPO_NAME} expo - Visitor Registration`;
  const interests = Array.isArray(productInterests) ? productInterests.filter(Boolean).join(", ") : productInterests;

  const rows = [
    ["Event Name", eventName],
    ["First Name", firstName],
    ["Last Name", lastName],
    ["Organisation", organisation],
    ["Designation", designation],
    ["Department", department],
    ["Email", email],
    ["Mobile No", mobile],
    ["City", city],
    ["State", state],
    ["Country", country],
    ["Key Track", keyTrack],
    ["Objective of your visit", visitObjective],
    ["Product Interest", interests]
  ].filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "");

  const qrBuffer = await QRCode.toBuffer(String(registrationId), { width: 300, margin: 1 });

  const intro = `Thank you for your registration. The ${EXPO_NAME} expo is looking forward to welcoming you to the expo during ${VALID_DATES} at ${VENUE}.`;

  const text =
    `${intro}\nLocation of Bharat Mandapam: ${VENUE_URL}\n\n` +
    `Registration ID: ${registrationId}\nStatus: ${status}\nValid: ${VALID_DATES}\n\n` +
    `Please Note:\n${NOTES.map((n) => `- ${n}`).join("\n")}\n\n` +
    rows.map(([l, v]) => `${l}: ${v}`).join("\n");

  const e = escapeHtml;
  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#222;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;"><tr><td align="center" style="padding:20px 10px;">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;padding:24px;">
<tr><td style="font-size:15px;line-height:1.5;">
  <p style="margin:0 0 12px;">${e(intro)}</p>
  <p style="margin:0 0 16px;">Location of Bharat Mandapam: <a href="${VENUE_URL}">${VENUE_URL}</a></p>
</td></tr>
<tr><td align="center" style="padding:8px 0 16px;">
  <img src="cid:visitor-qr" alt="Registration QR Code" width="200" height="200" style="display:block;">
</td></tr>
<tr><td style="font-size:15px;line-height:1.6;">
  <strong>Registration ID:</strong> ${e(registrationId)}<br>
  <strong>Status:</strong> ${e(status)}<br>
  <strong>Valid:</strong> ${e(VALID_DATES)}
</td></tr>
<tr><td style="font-size:14px;line-height:1.5;padding-top:16px;">
  <strong>Please Note:</strong>
  <ul style="margin:6px 0 0;padding-left:20px;">${NOTES.map((n) => `<li>${e(n)}</li>`).join("")}</ul>
</td></tr>
<tr><td style="padding:16px 0;"><hr style="border:0;border-top:1px dotted #999;"></td></tr>
<tr><td>
  <table width="100%" cellpadding="6" cellspacing="0" style="font-size:14px;border-collapse:collapse;">
  ${rows
    .map(
      ([l, v]) =>
        `<tr><td style="width:40%;border-bottom:1px solid #eee;"><strong>${e(l)}</strong></td><td style="border-bottom:1px solid #eee;">${e(String(v))}</td></tr>`
    )
    .join("")}
  </table>
</td></tr>
</table>
</td></tr></table>
</body></html>`;

  return {
    subject: eventName,
    text,
    html,
    attachments: [{ filename: "registration-qr.png", content: qrBuffer, cid: "visitor-qr", contentType: "image/png" }]
  };
}

module.exports = { buildVisitorEmail };
