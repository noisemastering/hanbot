// scripts/seedRolesAndProfiles.js
// Migrates existing hardcoded roles and profiles to the database

const mongoose = require("mongoose");
require("dotenv").config();

const Role = require("../models/Role");
const Profile = require("../models/Profile");

async function seedRolesAndProfiles() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB");

    // ==================== CREATE ROLES ====================
    console.log("\n📋 Creating Roles...\n");

    const rolesData = [
      {
        name: "super_admin",
        label: "Super Administrador",
        description: "Control total del sistema. Puede gestionar roles, perfiles y todos los usuarios.",
        permissions: ["*"],
        allowsProfiles: false,
        isSystem: true
      },
      {
        name: "admin",
        label: "Administrador",
        description: "Puede gestionar perfiles y usuarios (excepto Super Admins y otros Admins).",
        permissions: ["*"],
        allowsProfiles: false,
        isSystem: true
      },
      {
        name: "super_user",
        label: "Super Usuario",
        description: "Usuario avanzado con acceso completo según su perfil.",
        permissions: ["conversations", "campaigns", "adsets", "ads", "products", "analytics", "families", "master-catalog", "usos", "overview"],
        allowsProfiles: true,
        isSystem: true
      },
      {
        name: "user",
        label: "Usuario",
        description: "Usuario estándar con acceso limitado según su perfil.",
        permissions: [],
        allowsProfiles: true,
        isSystem: true
      }
    ];

    const createdRoles = {};

    for (const roleData of rolesData) {
      let role = await Role.findOne({ name: roleData.name });

      if (role) {
        console.log(`⚠️  Role "${roleData.name}" already exists. Updating...`);
        // Update existing role
        Object.assign(role, roleData);
        await role.save();
      } else {
        console.log(`➕ Creating role "${roleData.name}"...`);
        role = new Role(roleData);
        await role.save();
      }

      createdRoles[roleData.name] = role;
      console.log(`   ✅ ${role.label} (${role.name})`);
      console.log(`      Permissions: ${role.permissions.join(", ")}`);
      console.log(`      Allows Profiles: ${role.allowsProfiles}\n`);
    }

    // ==================== CREATE PROFILES ====================
    console.log("\n👤 Creating Profiles...\n");

    const profilesData = [
      // Super User Profiles
      {
        name: "accounting",
        label: "Contabilidad",
        description: "Perfil de contabilidad con acceso completo a análisis y datos.",
        role: createdRoles.super_user._id,
        permissions: ["conversations", "campaigns", "adsets", "ads", "products", "analytics", "families", "master-catalog", "usos", "overview"],
        landingPage: "/",
        isSystem: true
      },
      {
        name: "sales",
        label: "Ventas",
        description: "Perfil de ventas con acceso completo a campañas y productos.",
        role: createdRoles.super_user._id,
        permissions: ["conversations", "campaigns", "adsets", "ads", "products", "analytics", "families", "master-catalog", "usos", "overview"],
        landingPage: "/",
        isSystem: true
      },
      // User Profiles
      {
        name: "campaign_manager",
        label: "Administrador de Campaña",
        description: "Gestión de conversaciones, campañas y productos.",
        role: createdRoles.user._id,
        permissions: ["campaign-overview", "conversations", "campaigns", "adsets", "ads", "products", "tracked-links"],
        landingPage: "/",
        isSystem: true
      },
      {
        name: "salesman",
        label: "Ventas",
        description: "Acceso solo a conversaciones.",
        role: createdRoles.user._id,
        permissions: ["conversations"],
        landingPage: "/conversations",
        isSystem: true
      }
    ];

    for (const profileData of profilesData) {
      let profile = await Profile.findOne({ name: profileData.name });

      if (profile) {
        console.log(`⚠️  Profile "${profileData.name}" already exists. Updating...`);
        // Update existing profile
        Object.assign(profile, profileData);
        await profile.save();
      } else {
        console.log(`➕ Creating profile "${profileData.name}"...`);
        profile = new Profile(profileData);
        await profile.save();
      }

      await profile.populate("role", "name label");
      console.log(`   ✅ ${profile.label} (${profile.name})`);
      console.log(`      Role: ${profile.role.label}`);
      console.log(`      Permissions: ${profile.permissions.join(", ")}\n`);
    }

    console.log("\n✅ Migration complete! All roles and profiles have been seeded.\n");

    // Display summary
    console.log("📊 Summary:");
    console.log(`   Roles: ${Object.keys(createdRoles).length}`);
    console.log(`   Profiles: ${profilesData.length}`);
    console.log("\n");

    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

seedRolesAndProfiles();
