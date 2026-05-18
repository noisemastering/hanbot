const mongoose = require("mongoose");

const crossSellRuleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    sourceProductFamilyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProductFamily",
      required: true
    },
    targetProductFamilyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProductFamily",
      required: true
    },
    triggerType: {
      type: String,
      enum: ["post_purchase", "in_conversation", "cart_suggestion"],
      required: true
    },
    priority: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
    conditions: {
      minOrderAmount: { type: Number, default: null },
      minQuantity: { type: Number, default: null }
    },
    message: { type: String }
  },
  { timestamps: true }
);

module.exports = mongoose.model("CrossSellRule", crossSellRuleSchema);
