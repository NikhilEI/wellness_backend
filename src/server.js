require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const pool = require("./db/pool");
const newsletterRouter = require("./routes/newsletter");
const spaceBookingRouter = require("./routes/spaceBooking");
const otpRouter = require("./routes/otp");
const visitorRegistrationRouter = require("./routes/visitorRegistration");
const speakerRegistrationRouter = require("./routes/speakerRegistration");
const mediaRegistrationRouter = require("./routes/mediaRegistration");
const hostedBuyerRegistrationRouter = require("./routes/hostedBuyerRegistration");
const brochureDownloadRouter = require("./routes/brochureDownload");
const exhibitorZoneRouter = require("./routes/exhibitorZone");
const { notFoundHandler, errorHandler } = require("./middleware/errorHandler");

const app = express();

const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: true
  })
);
app.use(express.json());
app.use(cookieParser());

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/newsletter", newsletterRouter);
app.use("/api/space-booking", spaceBookingRouter);
app.use("/api/otp", otpRouter);
app.use("/api/visitor-registration", visitorRegistrationRouter);
app.use("/api/speaker-registration", speakerRegistrationRouter);
app.use("/api/media-registration", mediaRegistrationRouter);
app.use("/api/hosted-buyer-registration", hostedBuyerRegistrationRouter);
app.use("/api/brochure-download", brochureDownloadRouter);
app.use("/api/exhibitor-zone", exhibitorZoneRouter);

app.use("/api/exhibitor-zone", notFoundHandler);
app.use(errorHandler);

const PORT = process.env.PORT || 4010;
app.listen(PORT, async () => {
  console.log(`Wellness India Expo backend listening on port ${PORT}`);

  try {
    await pool.query("SELECT 1");
    console.log(`Database connected (${process.env.DB_NAME || "wellness_india_expo"} @ ${process.env.DB_HOST || "localhost"}:${process.env.DB_PORT || 3306})`);
  } catch (err) {
    console.error(`Database connection FAILED: ${err.message}`);
  }
});
