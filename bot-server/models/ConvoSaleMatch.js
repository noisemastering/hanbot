const mongoose = require("mongoose");

// Conversation ↔ Sale match.
//
// Attributes a paid ml_sales order to a CONVERSATION by cross-referencing the
// identity/intent signals a chat exposes (name, zip, city, item asked for)
// against the sale's ship-to + buyer + item. This is the conversation-centric
// counterpart to the older click-based conversionCorrelation (which needs a
// tracked ClickLog); it catches purchases from chats that never clicked a link.
//
// _id = `${psid}::${orderId}` → idempotent, one row per (conversation, order).
const ConvoSaleMatchSchema = new mongoose.Schema(
  {
    _id: { type: String }, // `${psid}::${orderId}`
    psid: { type: String },
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation" },
    orderId: { type: String }, // ml_sales _id (ML order id)

    certainty: { type: Number }, // 0-100
    confidence: { type: String }, // high | medium | low
    undisputed: { type: Boolean, default: false },
    ventaIndirecta: { type: Boolean, default: false },
    reason: { type: String }, // human-readable tier explanation (es-MX)

    // which signals fired
    signals: {
      zip: { type: Boolean, default: false },
      city: { type: Boolean, default: false },
      name: { type: Boolean, default: false },
      nickname: { type: Boolean, default: false },
      item: { type: Boolean, default: false },
    },

    // what was compared (audit trail)
    matchDetails: {
      convoName: String,
      saleReceiverName: String,
      saleBuyerName: String,
      saleNickname: String,
      convoZip: String,
      saleZip: String,
      convoCity: String,
      saleCity: String,
      convoFamilyIds: [String],
      convoSizes: { type: [String], default: undefined }, // readable sizes the convo discussed
      convoSizesOnDay: { type: [String], default: undefined }, // discussed on the sale's day
      convoSizesOther: { type: [String], default: undefined }, // discussed on other days
      convoProduct: { type: String }, // product line the convo was about
      saleProduct: { type: String }, // ML product bought, resolved from title vs our catalog
      saleItemIds: [String],
      poiFuzzy: Boolean, // product-root-name appeared in item title (weak signal, informational)
      minutesConvoToSale: Number,
      gapHoursToSale: Number, // hours from chat's last activity → sale (0 = purchased during the chat)
    },

    // denormalized sale snapshot so the match is reviewable without a join
    sale: {
      orderId: String,
      dateCreated: Date,
      status: String,
      totalAmount: Number,
      itemTitle: String,
      buyerNickname: String,
      buyerId: String, // ML buyer account id — canonical "same client" key for order stacking
      shippingCity: String,
      shippingState: String,
      shippingZip: String,
      receiverName: String,
    },

    // Safety net: what product(s) we shared/clicked links for vs what they bought.
    // Flags when the purchase differs from the shared link (wrong product tracked,
    // wrong link sent, or the client changed their mind).
    linkAudit: {
      sharedProducts: { type: [String], default: undefined }, // sizes we shared links for
      clickedProducts: { type: [String], default: undefined }, // sizes they actually clicked
      boughtProduct: { type: String }, // size purchased
      matchedShared: { type: Boolean }, // bought ∈ shared
      matchedClicked: { type: Boolean }, // bought ∈ clicked
      mismatch: { type: Boolean }, // bought a product we did NOT share a link for
    },

    method: { type: String, default: "convo_sale" },
    matchedAt: { type: Date },

    // HUMAN OVERRIDE (a person's verdict beats the algorithm). Re-applied every run
    // from the authoritative Conversation.saleOverride so a full rebuild never loses it.
    //   "confirmed" → the human affirms this IS a real sale (kept, counted)
    //   "rejected"  → the human says this is NOT a sale (kept for audit, EXCLUDED from counts)
    humanVerdict: { type: String, enum: ["confirmed", "rejected", null], default: null },
    human: { type: Boolean, default: false }, // synthetic: human-affirmed sale with no system order
    humanBy: { type: String },
    humanAt: { type: Date },
    humanNote: { type: String },
  },
  { versionKey: false, minimize: false, collection: "convo_sale_matches" }
);

ConvoSaleMatchSchema.index({ psid: 1 });
ConvoSaleMatchSchema.index({ orderId: 1 });
ConvoSaleMatchSchema.index({ certainty: -1 });
ConvoSaleMatchSchema.index({ "sale.dateCreated": -1 });

module.exports =
  mongoose.models.ConvoSaleMatch || mongoose.model("ConvoSaleMatch", ConvoSaleMatchSchema);
