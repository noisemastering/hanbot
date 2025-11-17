// models/Role.js
const mongoose = require("mongoose");

const roleSchema = new mongoose.Schema(
  {
    // Internal identifier (e.g., 'super_admin', 'admin')
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

    // Description of the role
    description: {
      type: String,
      default: ""
    },

    // Permissions (sections this role can access)
    // ['*'] means all sections
    // Or specific sections: ['conversations', 'campaigns', etc.]
    permissions: {
      type: [String],
      default: []
    },

    // Whether this role can have profiles
    allowsProfiles: {
      type: Boolean,
      default: false
    },

    // System roles cannot be deleted (super_admin, admin)
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

module.exports = mongoose.model("Role", roleSchema);
