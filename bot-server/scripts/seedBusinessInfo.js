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
        "442 123 4567", // Replace with real phone
        "442 765 4321"  // Replace with real phone
      ],
      hours: "Lunes a Viernes de 9:00 a 18:00",
      address: "Calle Loma de San Gremal No. 108, bodega 73, Col. Ejido Santa María Magdalena, C.P. 76137, Santiago de Querétaro, Qro.",
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
