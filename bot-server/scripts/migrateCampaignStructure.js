// scripts/migrateCampaignStructure.js
// Migrate existing campaign to new hierarchical structure
require('dotenv').config();
const mongoose = require('mongoose');
const Campaign = require('../models/Campaign');
const AdSet = require('../models/AdSet');
const Ad = require('../models/Ad');

async function migrateCampaignStructure() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Find the existing campaign
    const existingCampaign = await Campaign.findOne({});

    if (!existingCampaign) {
      console.log('❌ No campaign found to migrate');
      return;
    }

    console.log('📦 Found campaign:', existingCampaign.name);
    console.log('   Old structure:', existingCampaign.source);

    // Update campaign with new structure
    existingCampaign.fbCampaignId = existingCampaign.source?.campaign_id || '';
    existingCampaign.fbAdAccountId = existingCampaign.source?.ad_account_id || '';
    existingCampaign.status = existingCampaign.active ? 'ACTIVE' : 'PAUSED';

    // Remove old source field
    existingCampaign.source = undefined;

    await existingCampaign.save();
    console.log('✅ Campaign updated with new structure');
    console.log('   FB Campaign ID:', existingCampaign.fbCampaignId);

    // Create AdSet from the old data
    const oldAdSetId = existingCampaign.fbCampaignId ?
      `${existingCampaign.fbCampaignId}_adset` : '120232182338610686';

    let adSet = await AdSet.findOne({ fbAdSetId: oldAdSetId });

    if (!adSet) {
      adSet = await AdSet.create({
        campaignId: existingCampaign._id,
        fbAdSetId: oldAdSetId,
        name: `${existingCampaign.name} - AdSet Principal`,
        status: 'ACTIVE',
        targeting: {
          locations: ['Mexico'],
          ageMin: 25,
          ageMax: 60,
          interests: ['jardinería', 'mejoras del hogar', 'construcción']
        },
        optimizationGoal: 'LINK_CLICKS',
        billingEvent: 'IMPRESSIONS',
        placements: ['facebook_feed', 'instagram_feed']
      });

      console.log('✅ AdSet created:', adSet.name);
      console.log('   FB AdSet ID:', adSet.fbAdSetId);
    } else {
      console.log('ℹ️  AdSet already exists:', adSet.name);
    }

    // Create Ad from the old data
    const oldAdId = existingCampaign.fbCampaignId ?
      `${existingCampaign.fbCampaignId}_ad` : '120232182338600686';

    let ad = await Ad.findOne({ fbAdId: oldAdId });

    if (!ad) {
      ad = await Ad.create({
        adSetId: adSet._id,
        fbAdId: oldAdId,
        name: `${existingCampaign.name} - Anuncio Principal`,
        status: 'ACTIVE',
        creative: {
          headline: existingCampaign.name,
          body: existingCampaign.description || 'Malla sombra de calidad para tu hogar o negocio',
          callToAction: 'LEARN_MORE',
          linkUrl: `https://m.me/YOUR_PAGE?ref=${existingCampaign.ref}`
        },
        tracking: {
          utmSource: 'facebook',
          utmMedium: 'cpc',
          utmCampaign: existingCampaign.ref
        }
      });

      console.log('✅ Ad created:', ad.name);
      console.log('   FB Ad ID:', ad.fbAdId);
    } else {
      console.log('ℹ️  Ad already exists:', ad.name);
    }

    console.log('\n🎉 Migration completed successfully!');
    console.log('\nNew structure:');
    console.log('Campaign:', existingCampaign.name);
    console.log('  └─ AdSet:', adSet.name);
    console.log('      └─ Ad:', ad.name);

  } catch (error) {
    console.error('❌ Migration failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  }
}

// Run migration
migrateCampaignStructure();
