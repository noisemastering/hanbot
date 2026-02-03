// ai/handlers/index.js
// Central export point for all intent handlers

module.exports = {
  social: require('./social'),
  specs: require('./specs'),
  logistics: require('./logistics'),
  escalation: require('./escalation'),
  products: require('./products'),
  purchase: require('./purchase'),
  service: require('./service'),
  conversation: require('./conversation')
};
