// ai/flows/convo_groundcoverWholesale.js
// Convo flow for ground cover / tela antimaleza — wholesale, buyer (professional).
// Assembled from: master_flow + product_flow + wholesale_flow + buyer_flow
// Sale destination: lead capture → handoff to human specialist.

const convoFlow = require("./convoFlow");

const manifest = {
  type: 'convo_flow',
  name: 'convo_groundcoverWholesale',
  products: ['6939c512b7f2dfa6d9161f0a'],  // Ground Cover family (2x100m, 4x100m — negro/blanco)
  clientProfile: 'buyer',
  salesChannel: 'wholesale',
  endpointOfSale: 'human',
  voice: 'professional',
  installationNote: 'El ground cover se instala directamente sobre el suelo, se recomienda fijar con grapas o estacas. Ideal para control de maleza en agricultura, jardinería y paisajismo.',
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
