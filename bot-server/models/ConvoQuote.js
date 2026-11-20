// models/ConvoQuote.js
//
// A COTIZACIÓN a salesperson issued for a conversation the bot handed over.
// It is the sibling of a sale, and deliberately NOT one: nothing here touches
// ml_sales, convo_sale_matches or the revenue charts. The folio is typed in by
// the asesor from the system that issues it — we never generate it.
//
// One chat can hold several of these. A customer comes back weeks later about
// something else, and that is a different conversation on the same psid, so a
// quote records the VISIT it belongs to (sessionStart/sessionEnd) and the items
// it covers. Two quotes may share a visit when they cover different items.
const mongoose = require("mongoose");

const quoteItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "ProductFamily", default: null }, // null = fuera de catálogo
    productCode: { type: String, default: null },
    label: { type: String, required: true }, // what the asesor confirmed, as shown
    qty: { type: Number, default: 1 },
    source: { type: String, enum: ["bot", "manual"], default: "manual" }, // prefilled by the bot, or added by hand
  },
  { _id: false }
);

const convoQuoteSchema = new mongoose.Schema(
  {
    psid: { type: String, required: true, index: true },
    quoteNumber: { type: String, required: true }, // 4–6 digits, kept as text (leading zeros)
    items: { type: [quoteItemSchema], default: [] },
    sessionStart: { type: Date, default: null },
    sessionEnd: { type: Date, default: null },
    handoffAt: { type: Date, default: null },
    note: { type: String, default: null },
    by: { type: String, default: null },
  },
  { timestamps: true }
);

convoQuoteSchema.index({ psid: 1, quoteNumber: 1 }, { unique: true });
convoQuoteSchema.index({ createdAt: -1 });

module.exports = mongoose.model("ConvoQuote", convoQuoteSchema);
