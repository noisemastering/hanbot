// scripts/restructureCampaignData.js
// The existing "campaign" is actually an AD. Move it down and build the hierarchy properly.
require('dotenv').config();
const mongoose = require('mongoose');
const Campaign = require('../models/Campaign');
const AdSet = require('../models/AdSet');
const Ad = require('../models/Ad');

async function restructureCampaignData() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Get the misplaced "campaign" which is actually an ad
    const oldRecord = await Campaign.findOne({}).lean();
    console.log('\n📦 Found misplaced record (actually an AD):');
    console.log('   Name:', oldRecord.name);
    console.log('   Has initialMessage:', !!oldRecord.initialMessage);
    console.log('   Has description:', !!oldRecord.description);
    console.log('   Source:', oldRecord.source);

    // Extract IDs from source object or existing fields
    const fbCampaignId = oldRecord.source?.campaign_id || oldRecord.fbCampaignId || "120226050770160686";
    const fbAdSetId = oldRecord.source?.adset_id || "120232182338610686";
    const fbAdId = oldRecord.source?.ad_id || "120232182338600686";

    // Delete the misplaced record first (to avoid unique constraint on ref)
    await Campaign.findByIdAndDelete(oldRecord._id);
    console.log('\n✅ Deleted misplaced campaign record');

    // Also delete any incorrectly created AdSets and Ads
    await AdSet.deleteMany({});
    await Ad.deleteMany({});
    console.log('✅ Cleaned up old AdSet and Ad records');

    // Step 1: Create the REAL Campaign (top level)
    const newCampaign = await Campaign.create({
      ref: oldRecord.ref,
      name: oldRecord.name,
      fbCampaignId: fbCampaignId,
      fbAdAccountId: oldRecord.fbAdAccountId || "act_123456789",
      active: oldRecord.active,
      status: oldRecord.active ? "ACTIVE" : "PAUSED",
      objective: "OUTCOME_TRAFFIC",
      startDate: oldRecord.startDate,
      endDate: oldRecord.endDate,
      productFocus: oldRecord.productFocus,
      defaultFlow: oldRecord.defaultFlow,
      conversionGoal: oldRecord.conversionGoal,
      metrics: {
        visits: 0,
        interactions: 0,
        clicks: 0,
        leads: 0,
        conversions: 0
      }
    });
    console.log('\n✅ Created proper Campaign:');
    console.log('   ID:', newCampaign._id);
    console.log('   FB Campaign ID:', newCampaign.fbCampaignId);

    // Step 2: Create the AdSet (middle level)
    const newAdSet = await AdSet.create({
      campaignId: newCampaign._id,
      fbAdSetId: fbAdSetId,
      name: `${oldRecord.name} - AdSet Principal`,
      status: "ACTIVE",
      targeting: {
        locations: ["Mexico"],
        ageMin: 25,
        ageMax: 60,
        interests: ["jardinería", "mejoras del hogar", "construcción"]
      },
      optimizationGoal: "LINK_CLICKS",
      billingEvent: "IMPRESSIONS",
      placements: ["facebook_feed", "instagram_feed"],
      metrics: {
        impressions: 0,
        clicks: 0,
        spend: 0,
        conversions: 0,
        reach: 0
      }
    });
    console.log('\n✅ Created AdSet:');
    console.log('   ID:', newAdSet._id);
    console.log('   FB AdSet ID:', newAdSet.fbAdSetId);

    // Step 3: Create the proper Ad (bottom level) - THIS is what the old record really was
    const newAd = await Ad.create({
      adSetId: newAdSet._id,
      fbAdId: fbAdId,
      name: `${oldRecord.name} - Anuncio Principal`,
      status: "ACTIVE",
      creative: {
        headline: oldRecord.name,
        body: oldRecord.description,
        description: oldRecord.initialMessage,
        callToAction: "LEARN_MORE",
        linkUrl: `https://m.me/YOUR_PAGE?ref=${oldRecord.ref}`
      },
      tracking: {
        utmSource: "facebook",
        utmMedium: "cpc",
        utmCampaign: oldRecord.ref
      },
      metrics: {
        impressions: 0,
        clicks: 0,
        spend: 0,
        conversions: 0,
        reach: 0
      }
    });
    console.log('\n✅ Created Ad:');
    console.log('   ID:', newAd._id);
    console.log('   FB Ad ID:', newAd.fbAdId);

    console.log('\n🎉 Restructuring complete!');
    console.log('\n✅ New hierarchy:');
    console.log('Campaign (FB ID: ' + newCampaign.fbCampaignId + '):', newCampaign.name);
    console.log('  └─ AdSet (FB ID: ' + newAdSet.fbAdSetId + '):', newAdSet.name);
    console.log('      └─ Ad (FB ID: ' + newAd.fbAdId + '):', newAd.name);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  }
}

restructureCampaignData();
