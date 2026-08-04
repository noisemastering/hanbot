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
    body: { type: String, required: true }, // the actual message text (may hold dynamic tokens)
    category: { type: String, default: null, trim: true }, // optional grouping
    pinned: { type: Boolean, default: false }, // stays FIRST, above the popularity sort
    order: { type: Number, default: 0 }, // manual sort (used only among pinned, if ever >1)
    dynamic: { type: Boolean, default: false }, // body has {{tokens}} resolved live at insert time
    createdBy: { type: String, default: null }, // username/email of the author
    usageCount: { type: Number, default: 0 }, // times inserted — drives the popularity sort
  },
  { timestamps: true }
);

// Sort: pinned first, then by popularity (most-used), then oldest — the exact
// requirement ("first one pinned; the rest by popularity, which changes over time").
cannedMessageSchema.index({ pinned: -1, usageCount: -1, createdAt: 1 });

module.exports = mongoose.model("CannedMessage", cannedMessageSchema);
