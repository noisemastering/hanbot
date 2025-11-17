// scripts/cleanupCampaign.js
// Remove the old 'source' object from the campaign since we now have separate models
require('dotenv').config();
const mongoose = require('mongoose');
const Campaign = require('../models/Campaign');

async function cleanupCampaign() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const campaign = await Campaign.findOne({});

    console.log('\n📦 Before cleanup:');
    console.log('Has source object:', !!campaign.source);
    console.log('Source:', campaign.source);

    // Remove the old source object
    campaign.source = undefined;
    campaign.markModified('source');

    await campaign.save();

    console.log('\n✅ After cleanup:');
    console.log('Has source object:', !!campaign.source);

    // Verify the clean record
    const updated = await Campaign.findById(campaign._id);
    console.log('\n✅ Verified clean campaign:');
    console.log('Name:', updated.name);
    console.log('FB Campaign ID:', updated.fbCampaignId);
    console.log('Has source:', !!updated.source);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  }
}

cleanupCampaign();
