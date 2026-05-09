const mongoose = require('mongoose');

const flowPromptSchema = new mongoose.Schema({
  flow: { type: String, required: true },         // e.g. 'masterFlow', 'retailFlow'
  key: { type: String, required: true },           // e.g. 'classify', 'quote', 'detectWholesale'
  label: { type: String, required: true },         // Human-readable label for dashboard
  prompt: { type: String, required: true },        // The system prompt text
  description: { type: String, default: null },    // What this prompt does
  updatedAt: { type: Date, default: Date.now },
  updatedBy: { type: String, default: null }
});

flowPromptSchema.index({ flow: 1, key: 1 }, { unique: true });

module.exports = mongoose.model('FlowPrompt', flowPromptSchema);
