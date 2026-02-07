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
    // Role name (validated against Role collection)
    role: {
      type: String,
      required: true,
      default: "user",
      trim: true,
      lowercase: true
    },

    // Profile name (validated against Profile collection)
    // Required for roles that allowsProfiles
    profile: {
      type: String,
      default: null,
      trim: true,
      lowercase: true
    },

    // Status
    active: { type: Boolean, default: true },

    // Metadata
    lastLogin: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "DashboardUser" },

    // Password Reset
    resetPasswordToken: { type: String },
    resetPasswordExpires: { type: Date }
  },
  { timestamps: true }
);

// Validate role and profile against database before saving
dashboardUserSchema.pre("save", async function(next) {
  try {
    // Only validate if role or profile has been modified
    if (this.isModified("role") || this.isModified("profile")) {
      const Role = mongoose.model("Role");
      const Profile = mongoose.model("Profile");

      // Validate role exists and is active
      if (this.role) {
        const roleDoc = await Role.findOne({ name: this.role, active: true });
        if (!roleDoc) {
          return next(new Error(`Invalid role: ${this.role}. Role does not exist or is inactive.`));
        }

        // Validate profile if provided
        if (this.profile) {
          // Check if this role allows profiles
          if (!roleDoc.allowsProfiles) {
            return next(new Error(`Role ${this.role} does not allow profiles`));
          }

          // Check if profile exists, is active, and belongs to this role
          const profileDoc = await Profile.findOne({
            name: this.profile,
            active: true
          }).populate("role");

          if (!profileDoc) {
            return next(new Error(`Invalid profile: ${this.profile}. Profile does not exist or is inactive.`));
          }

          if (profileDoc.role.name !== this.role) {
            return next(new Error(`Profile ${this.profile} does not belong to role ${this.role}`));
          }
        } else {
          // If role requires profiles but none provided, error
          if (roleDoc.allowsProfiles) {
            // Actually, profiles might be optional even if allowed, so we won't enforce this
            // Just ensure profile is null for roles that don't allow profiles
          }
        }
      }
    }

    next();
  } catch (error) {
    next(error);
  }
});

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

// Method to get role label from database (async)
dashboardUserSchema.methods.getRoleLabel = async function() {
  try {
    const Role = mongoose.model("Role");
    const roleDoc = await Role.findOne({ name: this.role });
    return roleDoc ? roleDoc.label : this.role;
  } catch (error) {
    return this.role; // Fallback to role name if error
  }
};

// Method to get profile label from database (async)
dashboardUserSchema.methods.getProfileLabel = async function() {
  if (!this.profile) return null;

  try {
    const Profile = mongoose.model("Profile");
    const profileDoc = await Profile.findOne({ name: this.profile });
    return profileDoc ? profileDoc.label : this.profile;
  } catch (error) {
    return this.profile; // Fallback to profile name if error
  }
};

// Method to check permissions (async - fetches from database)
dashboardUserSchema.methods.canAccess = async function(section) {
  try {
    const Role = mongoose.model("Role");
    const Profile = mongoose.model("Profile");

    // Get role permissions
    const roleDoc = await Role.findOne({ name: this.role, active: true });
    if (!roleDoc) return false;

    // If role has wildcard permission, grant access
    if (roleDoc.permissions.includes("*")) {
      return true;
    }

    // Check role-level permissions
    if (roleDoc.permissions.includes(section)) {
      return true;
    }

    // If user has a profile, check profile-specific permissions
    if (this.profile) {
      const profileDoc = await Profile.findOne({
        name: this.profile,
        active: true
      });

      if (profileDoc) {
        // Profile permissions override/extend role permissions
        if (profileDoc.permissions.includes("*")) {
          return true;
        }
        if (profileDoc.permissions.includes(section)) {
          return true;
        }
      }
    }

    return false;
  } catch (error) {
    console.error("Error checking permissions:", error);
    return false;
  }
};

// Method to get all permissions for a user (for frontend caching)
dashboardUserSchema.methods.getAllPermissions = async function() {
  try {
    const Role = mongoose.model("Role");
    const Profile = mongoose.model("Profile");

    // Get role permissions
    const roleDoc = await Role.findOne({ name: this.role, active: true });
    if (!roleDoc) return [];

    // Start with role permissions
    let permissions = [...roleDoc.permissions];

    // If user has a profile, merge profile permissions
    if (this.profile) {
      const profileDoc = await Profile.findOne({
        name: this.profile,
        active: true
      });

      if (profileDoc) {
        // Merge profile permissions with role permissions (union)
        permissions = [...new Set([...permissions, ...profileDoc.permissions])];
      }
    }

    return permissions;
  } catch (error) {
    console.error("Error getting all permissions:", error);
    return [];
  }
};

// Virtual for full name
dashboardUserSchema.virtual("fullName").get(function() {
  return `${this.firstName} ${this.lastName}`;
});

module.exports = mongoose.model("DashboardUser", dashboardUserSchema);
