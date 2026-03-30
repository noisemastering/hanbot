// ai/flows/convo_rolloRaschelWholesale.js
// Convo flow for rollo de malla sombra raschel — wholesale, buyer (professional).
// Assembled from: master_flow + product_flow + wholesale_flow + buyer_flow
// All percentages: 35%, 50%, 70%, 80%.
// Sale destination: lead capture → handoff to human specialist.

const convoFlow = require("./convoFlow");

const manifest = {
  type: 'convo_flow',
  name: 'convo_rolloRaschelWholesale',
  products: [
    '693cce4c1eda701808d94434',  // 80%
    '693d8e7290cbebaaa1d46a7e',  // 70%
    '693d8ff990cbebaaa1d47029',  // 50%
    '693d907090cbebaaa1d47372'   // 35%
  ],
  clientProfile: 'buyer',
  salesChannel: 'wholesale',
  endpointOfSale: 'human',
  voice: 'professional',
  installationNote: 'Los rollos de malla sombra raschel se instalan con cable tensor o soga. Se recomienda dejar una ligera pendiente para escurrimiento de agua. Disponibles en anchos de 4m y largos de 100m.',
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
