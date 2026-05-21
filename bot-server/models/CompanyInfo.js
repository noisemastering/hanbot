const mongoose = require("mongoose");

const companyInfoSchema = new mongoose.Schema({
  _id: { type: String, default: 'hanlob' },

  // Basic info
  name: { type: String, default: 'Hanlob' },
  legalName: { type: String },
  tagline: { type: String },

  // Contact
  phones: [{ label: String, number: String }],
  emails: [{ label: String, email: String }],
  website: { type: String },

  // Location
  address: { type: String },
  city: { type: String },
  state: { type: String },
  zipCode: { type: String },
  country: { type: String, default: 'México' },
  googleMapsUrl: { type: String },
  googleMapsEmbed: { type: String },

  // Schedule
  schedule: [{
    day: { type: String }, // 'Lunes', 'Martes', etc.
    open: { type: String }, // '08:00'
    close: { type: String }, // '18:00'
    closed: { type: Boolean, default: false }
  }],
  scheduleNotes: { type: String }, // e.g. "Cerrado en días festivos"

  // Social media
  social: {
    facebook: String,
    instagram: String,
    tiktok: String,
    youtube: String,
    linkedin: String,
    twitter: String
  },

  // Business details
  rfc: { type: String },
  industry: { type: String },
  founded: { type: Number },
  employeeCount: { type: Number },
  description: { type: String },

  // Catalog
  catalog: {
    url: String,
    name: String,
    uploadedAt: Date
  },

  // Marketplace links
  marketplaces: [{
    name: String,     // 'Mercado Libre', 'Amazon', 'Walmart'
    url: String,
    sellerId: String,
    active: { type: Boolean, default: true }
  }],

  // Meta
  lastEditedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'DashboardUser' },
  lastEditedAt: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model("CompanyInfo", companyInfoSchema);
