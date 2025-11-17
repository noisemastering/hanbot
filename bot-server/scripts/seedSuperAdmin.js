// scripts/seedSuperAdmin.js
// Creates a Super Admin user for initial login
require("dotenv").config();
const mongoose = require("mongoose");
const DashboardUser = require("../models/DashboardUser");

const MONGO_URI = process.env.MONGODB_URI;

async function seedSuperAdmin() {
  try {
    // Connect to MongoDB
    await mongoose.connect(MONGO_URI);
    console.log("✅ Connected to MongoDB");

    // Check if Super Admin already exists
    const existing = await DashboardUser.findOne({ role: "super_admin" });
    if (existing) {
      console.log(`⚠️  Super Admin already exists: ${existing.username}`);
      console.log(`   Email: ${existing.email}`);
      process.exit(0);
    }

    // Create Super Admin
    const superAdmin = new DashboardUser({
      username: "admin",
      email: "admin@hanlob.com",
      password: "admin123", // CHANGE THIS IN PRODUCTION!
      firstName: "Super",
      lastName: "Admin",
      role: "super_admin",
      active: true
    });

    await superAdmin.save();

    console.log("✅ Super Admin created successfully!");
    console.log("   Username: admin");
    console.log("   Password: admin123");
    console.log("   Email: admin@hanlob.com");
    console.log("");
    console.log("⚠️  IMPORTANT: Change the password after first login!");

    process.exit(0);
  } catch (error) {
    console.error("❌ Error seeding Super Admin:", error);
    process.exit(1);
  }
}

seedSuperAdmin();
