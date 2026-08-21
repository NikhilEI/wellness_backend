require("dotenv").config();
const express = require("express");
const cors = require("cors");

const newsletterRouter = require("./routes/newsletter");
const spaceBookingRouter = require("./routes/spaceBooking");

const app = express();

const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true
  })
);
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/newsletter", newsletterRouter);
app.use("/api/space-booking", spaceBookingRouter);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Wellness India Expo backend listening on port ${PORT}`);
});
