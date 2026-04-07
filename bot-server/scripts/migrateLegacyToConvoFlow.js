// scripts/migrateLegacyToConvoFlow.js
// One-shot migration: set convoFlowRef on conversations whose currentFlow is a legacy value.
// After this runs, every active conversation routes through the new convo_flow system.

require('dotenv').config();
const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');

// Mapping: legacy currentFlow → target convoFlowRef
const LEGACY_TO_CONVO = {
  '6x4_promo': 'convo_promo6x4',
  'borde_separador': 'convo_bordeSeparadorRetail',
  'groundcover': 'convo_groundcoverWholesale',
  'malla_sombra': 'convo_confeccionadaRetail',
  'malla_sombra_raschel': 'convo_vende_malla',
  'reseller': 'convo_vende_malla',
  'rollo': 'convo_rolloRaschelWholesale'
};

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Migrating legacy conversations to convoFlowRef...\n`);

  let totalUpdated = 0;
  for (const [legacyFlow, convoRef] of Object.entries(LEGACY_TO_CONVO)) {
    const filter = {
      currentFlow: legacyFlow,
      $or: [
        { convoFlowRef: null },
        { convoFlowRef: { $exists: false } }
      ]
    };
    const count = await Conversation.countDocuments(filter);
    console.log(`  ${legacyFlow} → ${convoRef}: ${count} conversations`);

    if (!DRY_RUN && count > 0) {
      const result = await Conversation.updateMany(filter, {
        $set: {
          currentFlow: `convo:${convoRef}`,
          convoFlowRef: convoRef,
          convoFlowState: {}
        }
      });
      totalUpdated += result.modifiedCount;
    }
  }

  // Also upgrade conversations that have a convoFlowRef but stale legacy currentFlow
  const staleFilter = {
    convoFlowRef: { $ne: null, $exists: true },
    currentFlow: { $not: /^convo:/ }
  };
  const staleCount = await Conversation.countDocuments(staleFilter);
  console.log(`\n  Stale convoFlowRef-set with legacy currentFlow: ${staleCount} conversations`);

  if (!DRY_RUN && staleCount > 0) {
    // Each conversation needs its own update because currentFlow value depends on convoFlowRef
    const stale = await Conversation.find(staleFilter).select('_id convoFlowRef').lean();
    for (const c of stale) {
      await Conversation.updateOne(
        { _id: c._id },
        { $set: { currentFlow: `convo:${c.convoFlowRef}` } }
      );
      totalUpdated++;
    }
  }

  console.log(`\n${DRY_RUN ? '[DRY RUN] Would update' : 'Updated'} ${totalUpdated} conversations total.`);
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
