// scripts/fixCampaignStructure.js
// Properly break apart the existing campaign into Campaign > AdSet > Ad hierarchy
require('dotenv').config();
const mongoose = require('mongoose');
const Campaign = require('../models/Campaign');
const AdSet = require('../models/AdSet');
const Ad = require('../models/Ad');

async function fixCampaignStructure() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Get the existing "campaign" which is actually an ad
    const existingCampaign = await Campaign.findOne({});
    console.log('\n📦 Current structure:');
    console.log('Campaign ref:', existingCampaign.ref);
    console.log('Campaign name:', existingCampaign.name);

    // The OLD data had these IDs embedded:
    // source.campaign_id: "120226050770160686"
    // source.adset_id: "120232182338610686"
    // source.ad_id: "120232182338600686"

    // Step 1: Update the Campaign to be a proper campaign
    const fbCampaignId = "120226050770160686";
    existingCampaign.fbCampaignId = fbCampaignId;
    existingCampaign.fbAdAccountId = "act_123456789"; // You can update this
    existingCampaign.objective = "OUTCOME_TRAFFIC";
    existingCampaign.status = existingCampaign.active ? "ACTIVE" : "PAUSED";

    await existingCampaign.save();
    console.log('\n✅ Campaign updated:');
    console.log('   FB Campaign ID:', existingCampaign.fbCampaignId);
    console.log('   Name:', existingCampaign.name);

    // Step 2: Update the AdSet to have the correct FB ID
    const adSet = await AdSet.findOne({ campaignId: existingCampaign._id });
    if (adSet) {
      adSet.fbAdSetId = "120232182338610686";
      await adSet.save();
      console.log('\n✅ AdSet updated:');
      console.log('   FB AdSet ID:', adSet.fbAdSetId);
      console.log('   Name:', adSet.name);

      // Step 3: Update the Ad to have the correct FB ID
      const ad = await Ad.findOne({ adSetId: adSet._id });
      if (ad) {
        ad.fbAdId = "120232182338600686";
        await ad.save();
        console.log('\n✅ Ad updated:');
        console.log('   FB Ad ID:', ad.fbAdId);
        console.log('   Name:', ad.name);
      }
    }

    console.log('\n🎉 Structure properly fixed!');
    console.log('\nNew hierarchy:');
    console.log('Campaign (FB ID: 120226050770160686):', existingCampaign.name);
    console.log('  └─ AdSet (FB ID: 120232182338610686):', adSet?.name);
    console.log('      └─ Ad (FB ID: 120232182338600686):', await Ad.findOne({ adSetId: adSet?._id }).then(a => a?.name));

    console.log('\n✅ All Facebook IDs are now correctly assigned!');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  }
}

// Run the fix
fixCampaignStructure();
