const mongoose = require("mongoose");

// Lean, first-party sales record: ONE document per Mercado Libre order, holding
// the sales facts we actually use PLUS the ship-to address (zip/city/state/street/
// receiver) merged in from the linked /shipments/{id} resource.
//
// This is the free-tier-friendly alternative to storing ML's full verbatim
// payloads (orders+shipments ≈ 583MB, which overflows the 512MB cluster). Here
// each doc is ~0.8KB, so a full Dec-2025→now window (~86.5k orders) is ~60-70MB.
//
// _id = ML order id (String) → idempotent upserts; joinable to ML via id/shippingId.
const MLSaleSchema = new mongoose.Schema(
  {
    _id: { type: String }, // ML order id
    sellerId: { type: String },
    dateCreated: { type: Date },
    dateClosed: { type: Date },
    status: { type: String },
    statusDetail: { type: String },
    tags: { type: [String], default: undefined },
    totalAmount: { type: Number },
    paidAmount: { type: Number },
    currencyId: { type: String },
    packId: { type: String },
    buyer: {
      id: { type: String },
      nickname: { type: String },
      firstName: { type: String },
      lastName: { type: String },
    },
    items: [
      {
        _id: false,
        itemId: { type: String },
        title: { type: String },
        categoryId: { type: String },
        quantity: { type: Number },
        unitPrice: { type: Number },
        sellerSku: { type: String },
        variationId: { type: String },
      },
    ],
    shippingId: { type: String },
    // Merged from /shipments/{shippingId} (default format → full receiver_address).
    shipping: {
      id: { type: String },
      status: { type: String },
      substatus: { type: String },
      logisticType: { type: String },
      zip: { type: String },
      city: { type: String },
      state: { type: String },
      municipality: { type: String },
      neighborhood: { type: String },
      streetName: { type: String },
      streetNumber: { type: String },
      addressLine: { type: String },
      receiverName: { type: String },
      receiverPhone: { type: String },
      country: { type: String },
      lat: { type: Number },
      lng: { type: Number },
      fetched: { type: Boolean },
      httpStatus: { type: Number },
    },
    syncedAt: { type: Date },
  },
  { versionKey: false, minimize: false, collection: "ml_sales" }
);

MLSaleSchema.index({ sellerId: 1, dateCreated: 1 });
MLSaleSchema.index({ status: 1 });
MLSaleSchema.index({ "shipping.zip": 1 });
MLSaleSchema.index({ "shipping.state": 1 });
MLSaleSchema.index({ "items.itemId": 1 });
// Compound indexes for the correlation candidate queries (location + time window).
MLSaleSchema.index({ "shipping.zip": 1, dateCreated: 1 });
MLSaleSchema.index({ "shipping.city": 1, dateCreated: 1 });
// Plain date index for the no-location lookup (fetches all sales on the click days).
MLSaleSchema.index({ dateCreated: 1 });

module.exports = mongoose.models.MLSale || mongoose.model("MLSale", MLSaleSchema);
