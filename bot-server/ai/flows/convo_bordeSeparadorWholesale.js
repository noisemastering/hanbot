// ai/flows/convo_bordeSeparadorWholesale.js
// Convo flow for borde separador — wholesale, buyer (professional).
// Assembled from: master_flow + product_flow + wholesale_flow + buyer_flow
// Sale destination: lead capture → handoff to human specialist.

const convoFlow = require("./convoFlow");

const manifest = {
  type: 'convo_flow',
  name: 'convo_bordeSeparadorWholesale',
  products: ['68f6c372bfaca6a28884afd9'],  // Borde Separador family (6m, 9m, 18m, 54m)
  clientProfile: 'buyer',
  salesChannel: 'wholesale',
  endpointOfSale: 'human',
  voice: 'professional',
  installationNote: 'El borde separador se instala enterrándolo en el suelo, no requiere herramientas especiales.',
  allowListing: true,
  offersCatalog: false,
  promo: null
};

const instance = convoFlow.create(manifest);

module.exports = {
  manifest,
  handle: instance.handle,
  getProductCache: instance.getProductCache
};
