// ai/flows/convo_vende_malla.js
// Convo flow for malla sombra confeccionada reforzada — wholesale, reseller.
// Assembled from: master_flow + product_flow + wholesale_flow + reseller_flow

const convoFlow = require("./convoFlow");

const manifest = {
  type: 'convo_flow',
  name: 'convo_vende_malla',
  products: ['6942d85ba539ce7f9f28429b'],  // Confeccionada con Refuerzo — Rectangular (38 sizes)
  clientProfile: 'reseller',
  salesChannel: 'wholesale',
  endpointOfSale: 'human',
  voice: 'professional',
  allowListing: true,
  offersCatalog: true,
  promo: null,
  greeting: '¡Hola! Somos Hanlob, fabricantes de malla sombra raschel confeccionada con refuerzo. Si buscas ampliar tu catálogo o revender malla sombra, tenemos precios de mayoreo directo de fábrica. ¿Te gustaría conocer nuestras opciones?'
};

const instance = convoFlow.create(manifest);

module.exports = {
  manifest,
  handle: instance.handle,
  getProductCache: instance.getProductCache
};
