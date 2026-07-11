const mongoose = require("mongoose");

const commentSchema = new mongoose.Schema({
  text: { type: String, required: true },
  author: { type: mongoose.Schema.Types.ObjectId, ref: "DashboardUser", required: true },
  createdAt: { type: Date, default: Date.now }
});

const ticketSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    status: {
      type: String,
      enum: ["open", "review", "working", "solved", "dismissed", "ya_resuelto"],
      default: "open"
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium"
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DashboardUser",
      required: true
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DashboardUser",
      default: null
    },
    comments: [commentSchema],

    // Conversation linkage + categorization (for "report this conversation").
    psid: { type: String, default: null, index: true },
    category: {
      type: String,
      enum: [
        null, "",
        "wrong_info",          // bot gave incorrect information
        "wrong_price",         // bot quoted a wrong price
        "wrong_product",       // bot offered the wrong product/variant
        "out_of_family",       // bot offered something outside the configured family
        "missed_handoff",      // should have handed off to a human and didn't
        "bad_tone",            // tone/wording inappropriate
        "hallucination",       // bot invented info/policy
        "ignored_question",    // bot didn't answer what was asked
        "loop_repetition",     // bot repeated itself / got stuck
        "language_issue",      // wrong language / grammar
        "other"
      ],
      default: null
    },
    source: { type: String, default: "manual" }, // 'manual' | 'conversation_report'
    // Resolution: explanation written when a reported conversation is closed.
    // status 'solved' = fixed (with explanation); 'dismissed' = "Sin error".
    resolution: { type: String, default: null },
    noError: { type: Boolean, default: false }, // true when closed as "Sin error"
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "DashboardUser", default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Ticket", ticketSchema);
