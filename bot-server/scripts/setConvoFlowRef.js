require("dotenv").config();
const mongoose = require("mongoose");
const Ad = require("../models/Ad");

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const ad = await Ad.findOne({ fbAdId: "120238481994470686" });
  if (!ad) {
    console.log("Ad not found");
    process.exit(1);
  }
  console.log("Found ad:", ad.name);
  console.log("Current flowRef:", ad.flowRef || "none");
  console.log("Current convoFlowRef:", ad.convoFlowRef || "none");

  ad.convoFlowRef = "convo_bordeSeparadorRetail";
  await ad.save();

  console.log("\n--- Updated ---");
  console.log("name:", ad.name);
  console.log("fbAdId:", ad.fbAdId);
  console.log("flowRef:", ad.flowRef || "none");
  console.log("convoFlowRef:", ad.convoFlowRef);

  await mongoose.disconnect();
})();
