#!/usr/bin/env node
// Migration: convo_promo6x4 → convo_confeccionadaRetail + Promo plugin
//
// 1. Creates a Promo document for "Promo 6x4 Beige"
// 2. Migrates all ads with convoFlowRef=convo_promo6x4 → convo_confeccionadaRetail + promoId
// 3. Migrates active conversations with convoFlowRef=convo_promo6x4

require("dotenv").config();
const mongoose = require("mongoose");
const Ad = require("../models/Ad");
const Promo = require("../models/Promo");

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB");

  // 1. Create the Promo document (or find existing)
  let promo = await Promo.findOne({ name: "Promo 6x4 Beige" });
  if (!promo) {
    promo = await Promo.create({
      name: "Promo 6x4 Beige",
      promoProductIds: [new mongoose.Types.ObjectId("6943123eed2d4185ba47052f")],  // 6m x 4m
      promoPrices: [],
      timeframe: null,
      terms: null,
      colorNote: "Esta promoción es únicamente en color BEIGE. También manejamos negro pero no está incluido en esta promoción.",
      active: true
    });
    console.log(`✅ Created Promo: ${promo.name} (${promo._id})`);
  } else {
    console.log(`ℹ️  Promo already exists: ${promo.name} (${promo._id})`);
  }

  // 2. Migrate ads
  const ads = await Ad.find({ convoFlowRef: "convo_promo6x4" });
  console.log(`\n📋 Found ${ads.length} ads with convoFlowRef=convo_promo6x4`);

  for (const ad of ads) {
    await Ad.updateOne({ _id: ad._id }, {
      $set: {
        convoFlowRef: "convo_confeccionadaRetail",
        promoId: promo._id
      }
    });
    console.log(`  ✅ ${ad.name} → convo_confeccionadaRetail + promo`);
  }

  // 3. Migrate active conversations
  const Conversation = mongoose.connection.collection("conversations");
  const convos = await Conversation.updateMany(
    { convoFlowRef: "convo_promo6x4" },
    {
      $set: {
        convoFlowRef: "convo_confeccionadaRetail",
        currentFlow: "convo:convo_confeccionadaRetail",
        adPromo: {
          promoProductIds: ["6943123eed2d4185ba47052f"],
          promoPrices: [],
          timeframe: null,
          terms: null,
          colorNote: "Esta promoción es únicamente en color BEIGE. También manejamos negro pero no está incluido en esta promoción."
        }
      }
    }
  );
  console.log(`\n📋 Migrated ${convos.modifiedCount} conversations`);

  console.log("\n✅ Migration complete");
  await mongoose.disconnect();
}

run().catch(err => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
