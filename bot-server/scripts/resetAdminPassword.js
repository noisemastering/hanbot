// scripts/resetAdminPassword.js
// Resets admin password to default
require("dotenv").config();
const mongoose = require("mongoose");
const DashboardUser = require("../models/DashboardUser");

const MONGO_URI = process.env.MONGODB_URI;

async function resetAdminPassword() {
  try {
    // Connect to MongoDB
    await mongoose.connect(MONGO_URI);
    console.log("✅ Connected to MongoDB");

    // Find admin user
    const admin = await DashboardUser.findOne({ username: "admin" });
    if (!admin) {
      console.log("❌ Admin user not found");
      process.exit(1);
    }

    // Reset password
    admin.password = "admin123"; // Will be hashed by pre-save hook
    await admin.save();

    console.log("✅ Admin password reset successfully!");
    console.log("   Username: admin");
    console.log("   Password: admin123");
    console.log("");
    console.log("⚠️  You can now login with these credentials");

    process.exit(0);
  } catch (error) {
    console.error("❌ Error resetting password:", error);
    process.exit(1);
  }
}

resetAdminPassword();
