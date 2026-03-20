require("dotenv").config();
const mongoose = require("mongoose");
const Ad = require("../models/Ad");

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const ad = await Ad.findOne({ fbAdId: "120239556102430686" });
  if (!ad) {
    console.log("Ad not found");
    process.exit(1);
  }
  console.log("Found ad:", ad.name);
  console.log("Current flowRef:", ad.flowRef || "none");
  ad.flowRef = null;
  await ad.save();
  console.log("Cleared flowRef (back to default routing)");
  await mongoose.disconnect();
})();
