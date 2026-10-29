// scripts/seedBusinessInfo.js
require("dotenv").config();
const mongoose = require("mongoose");

const businessInfoSchema = new mongoose.Schema({
  _id: String,
  name: String,
  phones: [String],
  hours: String,
  address: String,
  updatedAt: Date
});

const BusinessInfo = mongoose.model("BusinessInfo", businessInfoSchema);

async function seedBusinessInfo() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB");

    // Remove existing if any
    await BusinessInfo.deleteOne({ _id: "hanlob-info" });

    // Insert Hanlob business information
    await BusinessInfo.create({
      _id: "hanlob-info",
      name: "Hanlob",
      phones: [
        "442 352 1646"
      ],
      hours: "Lunes a Viernes de 8:00 a 18:00",
      address: "QRO 110 7380, El Arroyito, Colón, Qro., C.P. 76286",
      updatedAt: new Date()
    });

    console.log("✅ Business info seeded successfully");

    await mongoose.disconnect();
    console.log("👋 Disconnected from MongoDB");

  } catch (error) {
    console.error("❌ Error seeding business info:", error);
    process.exit(1);
  }
}

seedBusinessInfo();
