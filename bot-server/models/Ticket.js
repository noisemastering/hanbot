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
      enum: ["open", "review", "working", "solved", "dismissed"],
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
    comments: [commentSchema]
  },
  { timestamps: true }
);

module.exports = mongoose.model("Ticket", ticketSchema);
