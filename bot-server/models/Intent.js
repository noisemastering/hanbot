const mongoose = require("mongoose");

const intentSchema = new mongoose.Schema({
  // Identity
  key: { type: String, required: true, unique: true }, // e.g., "greeting", "distributor_inquiry"
  name: { type: String, required: true },              // e.g., "Saludo inicial"
  description: { type: String },                        // For AI context
  category: { type: String, default: 'other' },  // References IntentCategory.key

  // Classification
  keywords: [String],           // Trigger words: ["hola", "buenos días", "hey"]
  patterns: [String],           // Regex patterns (optional)
  priority: { type: Number, default: 5, min: 1, max: 10 },

  // Response
  responseTemplate: { type: String }, // Default response text
  handlerType: {
    type: String,
    enum: ['auto_response', 'flow', 'human_handoff', 'ai_generate'],
    default: 'ai_generate'
  },

  // Status
  active: { type: Boolean, default: true },

  // Metrics
  hitCount: { type: Number, default: 0 },
  lastTriggered: { type: Date }
}, { timestamps: true });

// Indexes for efficient querying (key already has unique index from schema)
intentSchema.index({ active: 1, priority: -1 });
intentSchema.index({ category: 1 });

module.exports = mongoose.model("Intent", intentSchema);
