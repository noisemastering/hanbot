// Migrate existing super_users to have default profiles
const mongoose = require("mongoose");
require("dotenv").config();

const DashboardUser = require("../models/DashboardUser");

async function migrateProfiles() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB");

    // Find all super_users without a profile
    const superUsersWithoutProfile = await DashboardUser.find({
      role: "super_user",
      profile: null
    });

    console.log(`\n📊 Found ${superUsersWithoutProfile.length} super_user(s) without profile\n`);

    if (superUsersWithoutProfile.length === 0) {
      console.log("✅ All super_users already have profiles!");
      process.exit(0);
    }

    // Set default profile to 'accounting' for all super_users without profile
    for (const user of superUsersWithoutProfile) {
      console.log(`Updating ${user.username} (${user.fullName})...`);
      user.profile = 'accounting'; // Default to accounting
      await user.save();
      console.log(`  ✅ Profile set to: accounting (Contabilidad)\n`);
    }

    console.log(`\n✅ Migration complete! Updated ${superUsersWithoutProfile.length} user(s)\n`);
    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

migrateProfiles();
