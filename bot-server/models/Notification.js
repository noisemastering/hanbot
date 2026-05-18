const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true },
    type: {
      type: String,
      enum: ["global", "individual"],
      default: "global"
    },
    targetUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DashboardUser",
      default: null
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DashboardUser",
      required: true
    },
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "DashboardUser" }]
  },
  { timestamps: true }
);

module.exports = mongoose.model("Notification", notificationSchema);
