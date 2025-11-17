// scripts/checkRolesAndProfiles.js
// Quick check to verify roles and profiles in database

const mongoose = require("mongoose");
require("dotenv").config();

const Role = require("../models/Role");
const Profile = require("../models/Profile");

async function checkData() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB\n");

    // Check Roles
    const roles = await Role.find().sort({ name: 1 });
    console.log(`📋 Roles in database: ${roles.length}`);
    roles.forEach(role => {
      console.log(`  - ${role.name} (${role.label}) - Allows Profiles: ${role.allowsProfiles}`);
    });

    // Check Profiles
    const profiles = await Profile.find().populate('role', 'name label').sort({ name: 1 });
    console.log(`\n👤 Profiles in database: ${profiles.length}`);
    profiles.forEach(profile => {
      console.log(`  - ${profile.name} (${profile.label}) - Role: ${profile.role?.name}`);
    });

    console.log("\n✅ Check complete!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

checkData();
