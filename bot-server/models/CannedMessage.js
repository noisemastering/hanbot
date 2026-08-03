// models/CannedMessage.js
//
// Business-owned "canned messages" (saved replies) that a human agent can insert
// into the reply composer with one click — our own version of the Messenger
// Saved Replies feature (which is NOT exposed by any Graph API). Flat list +
// search + manual order; optional category for grouping.
const mongoose = require("mongoose");

const cannedMessageSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true }, // short label / shortcut, e.g. "Envío"
    body: { type: String, required: true }, // the actual message text inserted into the composer
    category: { type: String, default: null, trim: true }, // optional grouping
    order: { type: Number, default: 0 }, // manual sort within the list
    createdBy: { type: String, default: null }, // username/email of the author
    usageCount: { type: Number, default: 0 }, // times inserted — lets popular replies float up
  },
  { timestamps: true }
);

cannedMessageSchema.index({ order: 1, createdAt: 1 });

module.exports = mongoose.model("CannedMessage", cannedMessageSchema);
