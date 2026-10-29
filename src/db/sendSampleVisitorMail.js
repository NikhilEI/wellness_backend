// Usage: node src/db/sendSampleVisitorMail.js [recipient@example.com]
// Always writes sample-visitor-mail.html (open in a browser); sends it too if a recipient
// is given and SMTP_* is configured in .env.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { sendMail } = require("../lib/mailer");
const { buildVisitorEmail } = require("../lib/visitorEmail");

(async () => {
  const mail = await buildVisitorEmail({
    registrationId: "VIS416326",
    firstName: "Sujin",
    lastName: "Desingu",
    organisation: "Bergen Pipe Supports India",
    designation: "Business Development / Sales",
    department: "",
    email: "sujin.dhesingu@pipesupports.com",
    mobile: "918925824519",
    city: "Tirupati",
    state: "Andhra Pradesh",
    country: "India",
    keyTrack: "Longevity, Healthspan & Healthy Ageing",
    visitObjective: "Explore New Tech & Solutions",
    productInterests: ["Wellness Tech, Wearables & Diagnostics", "Nutraceuticals & Preventive Health"]
  });

  const qr = mail.attachments[0].content.toString("base64");
  const out = path.join(__dirname, "../../sample-visitor-mail.html");
  fs.writeFileSync(out, mail.html.replace("cid:visitor-qr", `data:image/png;base64,${qr}`));
  console.log("Preview written:", out);

  const to = process.argv[2];
  if (to) {
    await sendMail({ to, ...mail });
    console.log("Send attempted to", to);
  }
})();
