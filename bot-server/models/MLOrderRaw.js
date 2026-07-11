const mongoose = require("mongoose");

// RAW Mercado Libre order store.
//
// Unlike models/MLOrder (a normalized subset used for analytics/correlation),
// this collection stores each order EXACTLY as Mercado Libre delivers it — the
// full /orders/search result object, verbatim, with zero field-dropping. This
// is our own durable, first-party copy of the sales data.
//
// - strict:false  → every field ML sends today (and any it adds later) is kept.
// - _id = ML order id (as String, precision-safe) → a re-run UPSERTS/refreshes
//   the same order instead of duplicating it, and lets a paid→delivered status
//   change overwrite the older snapshot.
// - The only fields we add are underscore-prefixed operational metadata
//   (_sellerId / _source / _syncedAt); ML never uses leading underscores, so
//   the delivered schema stays intact and unambiguous.
const MLOrderRawSchema = new mongoose.Schema(
  {
    _id: { type: String }, // ML order id, verbatim (string form)
    _sellerId: { type: String },
    _source: { type: String }, // 'recent' | 'archived'
    _syncedAt: { type: Date },
  },
  {
    strict: false,
    minimize: false, // keep empty objects/arrays as ML sent them
    versionKey: false,
    collection: "ml_orders_raw",
  }
);

// Indexes over ML's OWN field names (queried straight off the raw doc).
MLOrderRawSchema.index({ _sellerId: 1 });
MLOrderRawSchema.index({ _syncedAt: 1 });
MLOrderRawSchema.index({ status: 1 });
MLOrderRawSchema.index({ date_created: 1 });

module.exports =
  mongoose.models.MLOrderRaw || mongoose.model("MLOrderRaw", MLOrderRawSchema);
