// Quick test to verify getRoleLabel and getProfileLabel return strings
const mongoose = require("mongoose");
require("dotenv").config();

const DashboardUser = require("../models/DashboardUser");

async function test() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB\n");

    const user = await DashboardUser.findOne();
    if (!user) {
      console.log("❌ No users found in database");
      process.exit(1);
    }

    const roleLabel = await user.getRoleLabel();
    const profileLabel = await user.getProfileLabel();

    console.log("User:", user.username);
    console.log("Role:", user.role);
    console.log("roleLabel type:", typeof roleLabel, "| value:", roleLabel);
    console.log("Profile:", user.profile);
    console.log("profileLabel type:", typeof profileLabel, "| value:", profileLabel);

    if (typeof roleLabel === 'string' && (typeof profileLabel === 'string' || profileLabel === null)) {
      console.log("\n✅ SUCCESS: Labels are strings (or null)!");
    } else {
      console.log("\n❌ ERROR: Labels are not strings!");
    }

    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

test();
