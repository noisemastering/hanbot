const mongoose = require("mongoose");

const convoFlowManifestSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  displayName: { type: String, required: true },
  type: { type: String, required: true, enum: ['convo_flow'], default: 'convo_flow' },

  // Core
  products: [{ type: mongoose.Schema.Types.ObjectId, ref: "ProductFamily" }],
  salesChannel: { type: String, required: true, enum: ['retail', 'wholesale'] },
  clientProfile: { type: String, required: true, enum: ['buyer', 'reseller'] },
  endpointOfSale: { type: String, enum: ['online_store', 'human'], default: 'online_store' },

  // Voice & behavior
  voice: { type: String, enum: ['casual', 'professional', 'technical'], default: 'casual' },
  installationNote: { type: String, default: null },
  allowListing: { type: Boolean, default: false },
  offersCatalog: { type: Boolean, default: false },

  // Promo (null = no promo; set via ad-level plugin now, but can still be hardcoded)
  promo: { type: mongoose.Schema.Types.Mixed, default: null },

  // Whether this flow has a custom JS handler (e.g., dimension parsing)
  // If true, the JS file takes precedence over the DB manifest for handle()
  hasCustomHandler: { type: Boolean, default: false },

  active: { type: Boolean, default: true },
  description: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model("ConvoFlowManifest", convoFlowManifestSchema);
