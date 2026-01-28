// ai/utils/intentGapLogger.js
// Logs potential intent gaps for curation
// Helps identify when messages fall through to fallback or get misclassified

const mongoose = require('mongoose');

// Schema for intent gap logging
const intentGapSchema = new mongoose.Schema({
  message: { type: String, required: true },
  normalizedMessage: { type: String },  // lowercase, trimmed
  psid: { type: String },

  // What happened
  reason: {
    type: String,
    enum: [
      'fallback_reached',      // Message went all the way to AI fallback
      'low_confidence',        // Intent classified but with low confidence (<0.7)
      'handler_failed',        // Intent matched but handler returned null
      'repetition_detected',   // Bot tried to repeat itself
      'human_escalation',      // Had to escalate to human
      'unknown_product',       // Product mention not recognized
      'unhandled_question'     // Question pattern detected but not handled
    ],
    required: true
  },

  // Context
  classifiedIntent: { type: String },  // What the classifier thought
  confidence: { type: Number },
  lastIntent: { type: String },        // Previous conversation intent
  productSpecs: { type: Object },      // Current basket state

  // For review
  suggestedIntent: { type: String },   // AI suggestion for what intent this could be
  reviewed: { type: Boolean, default: false },
  reviewedAt: { type: Date },
  addedToIntents: { type: Boolean, default: false },

  timestamp: { type: Date, default: Date.now }
});

// Index for efficient querying
intentGapSchema.index({ reason: 1, reviewed: 0, timestamp: -1 });
intentGapSchema.index({ normalizedMessage: 1 });  // Dedupe similar messages

const IntentGap = mongoose.model('IntentGap', intentGapSchema);

/**
 * Log a potential intent gap
 * @param {object} data - Gap data
 */
async function logIntentGap(data) {
  try {
    const {
      message,
      psid,
      reason,
      classifiedIntent,
      confidence,
      lastIntent,
      productSpecs,
      suggestedIntent
    } = data;

    const normalizedMessage = message?.toLowerCase().trim();

    // Don't log duplicates (same message within last hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const existing = await IntentGap.findOne({
      normalizedMessage,
      timestamp: { $gte: oneHourAgo }
    });

    if (existing) {
      console.log(`⚠️ Intent gap already logged recently: "${normalizedMessage.substring(0, 50)}..."`);
      return null;
    }

    const gap = await IntentGap.create({
      message,
      normalizedMessage,
      psid,
      reason,
      classifiedIntent,
      confidence,
      lastIntent,
      productSpecs,
      suggestedIntent
    });

    console.log(`📝 INTENT GAP LOGGED [${reason}]: "${message.substring(0, 50)}..."`);
    return gap;
  } catch (error) {
    console.error('Error logging intent gap:', error.message);
    return null;
  }
}

/**
 * Get unreviewed intent gaps for dashboard
 * @param {number} limit - Max results
 * @param {string} reason - Filter by reason (optional)
 */
async function getUnreviewedGaps(limit = 50, reason = null) {
  const query = { reviewed: false };
  if (reason) query.reason = reason;

  return IntentGap.find(query)
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
}

/**
 * Mark a gap as reviewed
 * @param {string} gapId - Gap ID
 * @param {boolean} addedToIntents - Whether it was added to intents
 */
async function markGapReviewed(gapId, addedToIntents = false) {
  return IntentGap.findByIdAndUpdate(gapId, {
    reviewed: true,
    reviewedAt: new Date(),
    addedToIntents
  });
}

/**
 * Get gap statistics for dashboard
 */
async function getGapStats() {
  const stats = await IntentGap.aggregate([
    {
      $group: {
        _id: '$reason',
        count: { $sum: 1 },
        unreviewed: {
          $sum: { $cond: [{ $eq: ['$reviewed', false] }, 1, 0] }
        }
      }
    },
    { $sort: { count: -1 } }
  ]);

  return stats;
}

module.exports = {
  IntentGap,
  logIntentGap,
  getUnreviewedGaps,
  markGapReviewed,
  getGapStats
};
