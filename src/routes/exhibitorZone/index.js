const express = require("express");

const router = express.Router();

router.use("/auth", require("./auth"));
router.use("/exhibitors", require("./exhibitors"));
router.use("/documents", require("./documents"));
router.use("/events", require("./events"));
router.use("/stalls", require("./stalls"));
router.use("/catalogue", require("./catalogue"));
router.use("/cart", require("./cart"));
router.use("/orders", require("./orders"));
router.use("/passes", require("./passes"));
router.use("/forms", require("./forms"));
router.use("/mandatory-forms", require("./mandatoryForms"));
router.use("/notifications", require("./notifications"));
router.use("/admin/dashboard", require("./admin/dashboard"));
router.use("/admin/users", require("./admin/users"));

module.exports = router;
