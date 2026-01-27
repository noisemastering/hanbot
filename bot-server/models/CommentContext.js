// models/CommentContext.js
// Tracks comments on posts to provide context when users message from comment threads
const mongoose = require("mongoose");

const commentContextSchema = new mongoose.Schema({
  // Facebook user ID (NOT PSID - feed webhook gives user ID, messaging gives PSID)
  fbUserId: { type: String, required: true, index: true },
  fbUserName: { type: String },

  // Post they commented on
  postId: { type: String, required: true },
  commentId: { type: String },
  commentText: { type: String },

  // Derived product context (populated later from post mapping)
  productInterest: { type: String },

  // Linked PSID once we correlate (user ID → PSID happens when they message)
  linkedPsid: { type: String, index: true },

  createdAt: { type: Date, default: Date.now, expires: 604800 } // TTL: 7 days
});

// Index for quick lookup
commentContextSchema.index({ createdAt: 1 }, { expireAfterSeconds: 604800 });

module.exports = mongoose.model("CommentContext", commentContextSchema);
