// Check super_user profiles
const mongoose = require("mongoose");
require("dotenv").config();

const DashboardUser = require("../models/DashboardUser");

async function checkProfiles() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB");

    const superUsers = await DashboardUser.find({ role: "super_user" });

    console.log(`\n📊 Found ${superUsers.length} super_user(s):\n`);

    superUsers.forEach(user => {
      console.log(`- ${user.username} (${user.fullName})`);
      console.log(`  Role: ${user.role}`);
      console.log(`  Profile: ${user.profile || 'NOT SET ❌'}`);
      console.log(`  Active: ${user.active}`);
      console.log('');
    });

    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

checkProfiles();
