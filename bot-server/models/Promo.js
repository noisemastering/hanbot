const mongoose = require("mongoose");

const promoSchema = new mongoose.Schema({
  name: { type: String, required: true },
  promoProductIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "ProductFamily"
  }],
  promoPrices: [{
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "ProductFamily" },
    price: { type: Number }
  }],
  timeframe: {
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null }
  },
  terms: { type: String, default: null },
  colorNote: { type: String, default: null },
  active: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model("Promo", promoSchema);
