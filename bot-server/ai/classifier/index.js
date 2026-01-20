// ai/classifier/index.js
// Layer 1: Intent Classification Module

const {
  classify,
  classifyMessage,
  quickClassify,
  logClassification,
  INTENTS,
  PRODUCTS
} = require("./intentClassifier");

module.exports = {
  // Main function
  classify,

  // Direct access
  classifyMessage,
  quickClassify,

  // Logging
  logClassification,

  // Constants
  INTENTS,
  PRODUCTS
};
