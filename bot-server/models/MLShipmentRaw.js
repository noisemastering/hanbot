const mongoose = require("mongoose");

// RAW Mercado Libre shipment store.
//
// The zip/ship-to address is NOT in the order payload — ML exposes it only via
// /shipments/{id}. This collection stores each shipment EXACTLY as ML delivers
// it (default format, which includes the full receiver_address: zip_code, city,
// state, neighborhood, street, receiver_name), verbatim, no normalization.
//
// - strict:false → every ML field kept (today's and any added later).
// - _id = ML shipment id (String) → joinable to ml_orders_raw via order.shipping.id;
//   a re-run UPSERTS the same shipment (e.g. status ready→delivered) instead of duping.
// - _httpStatus is set ONLY when the fetch failed (404/403) so the backfill can
//   skip permanently-unavailable shipments on re-runs instead of refetching forever.
const MLShipmentRawSchema = new mongoose.Schema(
  {
    _id: { type: String }, // ML shipment id, verbatim (string form)
    _orderId: { type: String }, // the ml_orders_raw _id this shipment belongs to
    _sellerId: { type: String },
    _syncedAt: { type: Date },
    _httpStatus: { type: Number }, // present only on a failed fetch (404/403)
  },
  {
    strict: false,
    minimize: false,
    versionKey: false,
    collection: "ml_shipments_raw",
  }
);

MLShipmentRawSchema.index({ _orderId: 1 });
MLShipmentRawSchema.index({ _sellerId: 1 });
MLShipmentRawSchema.index({ "receiver_address.zip_code": 1 });
MLShipmentRawSchema.index({ status: 1 });

module.exports =
  mongoose.models.MLShipmentRaw || mongoose.model("MLShipmentRaw", MLShipmentRawSchema);
