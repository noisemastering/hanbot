// models/PointOfSale.js
const mongoose = require('mongoose');

const pointOfSaleSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  // Optional default URL pattern (e.g., "https://mercadolibre.com.mx/")
  defaultUrl: {
    type: String,
    trim: true
  },
  // Optional icon URL or emoji
  icon: {
    type: String,
    trim: true
  },
  // Whether this POS is active and should be shown in dropdowns
  active: {
    type: Boolean,
    default: true
  },
  // Optional description
  description: {
    type: String,
    trim: true
  },
  // The company's CORE store. Exactly one POS should carry this. It's the default
  // marketplace every product is quoted/linked/priced against, unless a campaign
  // routes specific products to an alternate POS. Interchangeable: flip this to
  // move the core store (ML → the client's own store → Amazon → …).
  isDefault: {
    type: Boolean,
    default: false,
    index: true,
  },
  // Which price ADAPTER this POS uses (see ai/marketplace):
  //   'mercadolibre'   → live ML price via mlPriceLookup (the historical core).
  //   'http_price_api' → the POS's own price endpoint (see the price-API contract).
  //   'link_only'      → PRICE stays on the default channel (live ML); this POS only
  //                      supplies the buy LINK for the routed products (the trial mode).
  kind: {
    type: String,
    enum: ['mercadolibre', 'http_price_api', 'link_only'],
    default: 'mercadolibre',
  },
  // Config for kind:'http_price_api' — how to query this store for a live price.
  priceApi: {
    endpoint: { type: String, trim: true },   // e.g. https://sutienda.mx/api/price
    authToken: { type: String, trim: true },  // sent as `Authorization: Bearer <token>`
    skuParam: { type: String, trim: true, default: 'sku' }, // query-param name for the SKU
    taxIncluded: { type: Boolean, default: true }, // do returned prices already include IVA?
  },
  // Store-specific policies surfaced to the customer INSTEAD of the default channel's
  // when a product is sold through this POS (only price/refund/delivery differ).
  policies: {
    refund: {
      windowDays: { type: Number },
      url: { type: String, trim: true },
      note: { type: String, trim: true },
    },
    delivery: {
      cost: { type: Number },
      etaDays: { type: String, trim: true },
      coverage: { type: String, trim: true },
      note: { type: String, trim: true },
    },
  },
}, {
  timestamps: true
});

// Index for faster queries
pointOfSaleSchema.index({ name: 1 });
pointOfSaleSchema.index({ active: 1 });

const PointOfSale = mongoose.model('PointOfSale', pointOfSaleSchema);

module.exports = PointOfSale;
