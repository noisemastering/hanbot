// models/Profile.js
const mongoose = require("mongoose");

const profileSchema = new mongoose.Schema(
  {
    // Internal identifier (e.g., 'campaign_manager', 'salesman')
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true
    },

    // Display label in Spanish
    label: {
      type: String,
      required: true,
      trim: true
    },

    // Description of the profile
    description: {
      type: String,
      default: ""
    },

    // Which role this profile belongs to
    // Reference to Role model
    role: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Role",
      required: true
    },

    // Permissions specific to this profile
    // These override or extend the role's base permissions
    permissions: {
      type: [String],
      default: []
    },

    // Default landing page for users with this profile
    landingPage: { type: String, default: null, trim: true },

    // System profiles cannot be deleted
    isSystem: {
      type: Boolean,
      default: false
    },

    // Active status
    active: {
      type: Boolean,
      default: true
    },

    // Metadata
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DashboardUser"
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Profile", profileSchema);
