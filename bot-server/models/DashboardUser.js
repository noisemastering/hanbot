// models/DashboardUser.js
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const dashboardUserSchema = new mongoose.Schema(
  {
    // Basic Info
    username: { type: String, required: true, unique: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    password: { type: String, required: true },

    // Personal Info
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },

    // Access Control
    role: {
      type: String,
      enum: ["super_admin", "admin", "super_user", "user"],
      default: "user",
      required: true
    },

    // Profile (for 'user' and 'super_user' roles)
    profile: {
      type: String,
      enum: ["campaign_manager", "salesman", "accounting", "sales", null],
      default: null
    },

    // Status
    active: { type: Boolean, default: true },

    // Metadata
    lastLogin: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "DashboardUser" }
  },
  { timestamps: true }
);

// Hash password before saving
dashboardUserSchema.pre("save", async function(next) {
  if (!this.isModified("password")) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare password
dashboardUserSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Method to get role label in Spanish
dashboardUserSchema.methods.getRoleLabel = function() {
  const labels = {
    super_admin: "Super Admin",
    admin: "Admin",
    super_user: "Super Usuario",
    user: "Usuario"
  };
  return labels[this.role] || this.role;
};

// Method to get profile label in Spanish
dashboardUserSchema.methods.getProfileLabel = function() {
  const labels = {
    campaign_manager: "Administrador de Campaña",
    salesman: "Ventas",
    accounting: "Contabilidad",
    sales: "Ventas"
  };
  return this.profile ? labels[this.profile] : null;
};

// Method to check permissions
dashboardUserSchema.methods.canAccess = function(section) {
  const permissions = {
    super_admin: ["*"], // All sections
    admin: ["*"], // All sections (for now)
    super_user: {
      accounting: ["conversations", "campaigns", "adsets", "ads", "products", "analytics", "families", "master-catalog", "usos"],
      sales: ["conversations", "campaigns", "adsets", "ads", "products", "analytics", "families", "master-catalog", "usos"]
    },
    user: {
      campaign_manager: ["conversations", "campaigns", "adsets", "ads", "products"],
      salesman: ["conversations"]
    }
  };

  // Super Admin and Admin have access to everything
  if (this.role === "super_admin" || this.role === "admin") {
    return true;
  }

  // Super User has profile-based access
  if (this.role === "super_user" && this.profile) {
    return permissions.super_user[this.profile]?.includes(section) || false;
  }

  // User role depends on profile
  if (this.role === "user" && this.profile) {
    return permissions.user[this.profile]?.includes(section) || false;
  }

  return false;
};

// Virtual for full name
dashboardUserSchema.virtual("fullName").get(function() {
  return `${this.firstName} ${this.lastName}`;
});

module.exports = mongoose.model("DashboardUser", dashboardUserSchema);
