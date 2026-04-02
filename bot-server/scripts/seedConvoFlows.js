#!/usr/bin/env node
// Seed existing JS-based convo_flow manifests into ConvoFlowManifest collection.
// Safe to run multiple times — skips flows that already exist by name.

require("dotenv").config();
const mongoose = require("mongoose");
const ConvoFlowManifest = require("../models/ConvoFlowManifest");

const FLOWS = [
  {
    name: 'convo_confeccionadaRetail',
    displayName: 'Confeccionada (Menudeo)',
    description: 'Malla sombra confeccionada reforzada rectangular — menudeo, comprador casual',
    products: ['6942d85ba539ce7f9f28429b'],
    salesChannel: 'retail',
    clientProfile: 'buyer',
    endpointOfSale: 'online_store',
    voice: 'casual',
    installationNote: 'La malla viene lista para instalar con ojillos cada 80 cm. Solo se necesita soga o cable para sujetarla.',
    allowListing: false,
    offersCatalog: false,
    hasCustomHandler: true
  },
  {
    name: 'convo_bordeSeparadorRetail',
    displayName: 'Borde Separador (Menudeo)',
    description: 'Borde separador de jardín — menudeo, comprador casual',
    products: ['6942daa7a539ce7f9f284328'],
    salesChannel: 'retail',
    clientProfile: 'buyer',
    endpointOfSale: 'online_store',
    voice: 'casual',
    hasCustomHandler: true
  },
  {
    name: 'convo_bordeSeparadorWholesale',
    displayName: 'Borde Separador (Mayoreo)',
    description: 'Borde separador de jardín — mayoreo, comprador profesional',
    products: ['6942daa7a539ce7f9f284328'],
    salesChannel: 'wholesale',
    clientProfile: 'buyer',
    endpointOfSale: 'human',
    voice: 'professional',
    hasCustomHandler: true
  },
  {
    name: 'convo_rolloRaschelWholesale',
    displayName: 'Rollo Raschel (Mayoreo)',
    description: 'Rollo de malla raschel 35%-80% — mayoreo, comprador profesional',
    products: ['6942d67ba539ce7f9f28424d'],
    salesChannel: 'wholesale',
    clientProfile: 'buyer',
    endpointOfSale: 'human',
    voice: 'professional',
    offersCatalog: true,
    hasCustomHandler: true
  },
  {
    name: 'convo_groundcoverWholesale',
    displayName: 'Ground Cover (Mayoreo)',
    description: 'Ground cover / antimaleza — mayoreo, comprador profesional',
    products: ['6942db97a539ce7f9f284363'],
    salesChannel: 'wholesale',
    clientProfile: 'buyer',
    endpointOfSale: 'human',
    voice: 'professional',
    hasCustomHandler: true
  },
  {
    name: 'convo_vende_malla',
    displayName: 'Vende Malla (Distribuidor)',
    description: 'Confeccionada reforzada rectangular — mayoreo, revendedor',
    products: ['6942d85ba539ce7f9f28429b'],
    salesChannel: 'wholesale',
    clientProfile: 'reseller',
    endpointOfSale: 'human',
    voice: 'professional',
    offersCatalog: true,
    hasCustomHandler: true
  }
];

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB");

  for (const flow of FLOWS) {
    const existing = await ConvoFlowManifest.findOne({ name: flow.name });
    if (existing) {
      console.log(`  ⏭️  ${flow.name} already exists`);
      continue;
    }
    flow.products = flow.products.map(id => new mongoose.Types.ObjectId(id));
    await ConvoFlowManifest.create({ ...flow, type: 'convo_flow', active: true });
    console.log(`  ✅ ${flow.name} → ${flow.displayName}`);
  }

  console.log("\n✅ Seed complete");
  await mongoose.disconnect();
}

run().catch(err => { console.error("❌", err); process.exit(1); });
