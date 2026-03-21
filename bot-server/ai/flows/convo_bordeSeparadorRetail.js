// ai/flows/convo_bordeSeparadorRetail.js
// Convo flow for borde separador — retail, casual buyer.
// Assembled from: master_flow + product_flow + retail_flow + buyer_flow

const convoFlow = require("./convoFlow");

/**
 * Manifest — stored in DB, loaded here for now.
 * TODO: load from DB when flow registry is implemented.
 */
const manifest = {
  type: 'convo_flow',
  name: 'convo_bordeSeparadorRetail',
  products: ['68f6c372bfaca6a28884afd9'],  // Borde Separador family (all 4 sizes: 6m, 9m, 18m, 54m)
  clientProfile: 'buyer',
  salesChannel: 'retail',
  endpointOfSale: 'online_store',  // 'online_store' | 'human'
  voice: 'casual',
  installationNote: 'El borde separador se instala enterrándolo en el suelo, no requiere herramientas especiales.',
  allowListing: false,
  offersCatalog: false,
  promo: null
};

const instance = convoFlow.create(manifest);

module.exports = {
  manifest,
  handle: instance.handle,
  getProductCache: instance.getProductCache
};
