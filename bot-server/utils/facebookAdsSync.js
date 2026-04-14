// utils/facebookAdsSync.js
// Syncs campaigns, ad sets, and ads from Facebook Marketing API into MongoDB.
// NEVER overwrites bot-specific configuration fields (flowRef, audience, conversationGoal, etc.)

const axios = require("axios");
const Campaign = require("../models/Campaign");
const AdSet = require("../models/AdSet");
const Ad = require("../models/Ad");

const FB_API_VERSION = "v25.0";
const FB_GRAPH_URL = `https://graph.facebook.com/${FB_API_VERSION}`;
const AD_ACCOUNT_ID = process.env.FB_AD_ACCOUNT_ID;
const ACCESS_TOKEN = process.env.FB_MARKETING_TOKEN;

// ---------- helpers ----------

/**
 * Fetch all pages of a Facebook Graph API endpoint
 */
async function fetchAllPages(url, params = {}) {
  const results = [];
  let nextUrl = `${FB_GRAPH_URL}/${url}`;
  let isFirstRequest = true;

  while (nextUrl) {
    try {
      const config = isFirstRequest
        ? { params: { access_token: ACCESS_TOKEN, limit: 100, ...params } }
        : {}; // paging.next URLs already include all params

      const { data } = await axios.get(nextUrl, config);
      if (data.data) results.push(...data.data);
      nextUrl = data.paging?.next || null;
      isFirstRequest = false;
    } catch (err) {
      // Handle rate limits — back off and retry once
      if (err.response?.status === 429 || err.response?.data?.error?.code === 32) {
        console.log("⏳ Rate limited by Facebook, waiting 60s...");
        await sleep(60000);
        continue;
      }
      throw err;
    }
  }

  return results;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Slugify a campaign name into a ref string
 * e.g. "Rollos 90% campaña" → "rollos-90-campana"
 */
function slugify(name) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

/**
 * Ensure a ref is unique by appending -2, -3, etc. if needed
 */
async function uniqueRef(baseRef) {
  let ref = baseRef;
  let counter = 2;
  while (await Campaign.findOne({ ref })) {
    // Truncate base to leave room for suffix
    const suffix = `-${counter}`;
    ref = baseRef.slice(0, 50 - suffix.length) + suffix;
    counter++;
    if (counter > 100) break; // Safety valve
  }
  return ref;
}

/**
 * Extract targeting info from Facebook's complex targeting object
 */
function extractTargeting(fbTargeting) {
  if (!fbTargeting) return {};

  const targeting = {};

  // Locations
  if (fbTargeting.geo_locations) {
    const locs = [];
    if (fbTargeting.geo_locations.countries) {
      locs.push(...fbTargeting.geo_locations.countries);
    }
    if (fbTargeting.geo_locations.regions) {
      locs.push(...fbTargeting.geo_locations.regions.map(r => r.name));
    }
    if (fbTargeting.geo_locations.cities) {
      locs.push(...fbTargeting.geo_locations.cities.map(c => c.name));
    }
    if (locs.length) targeting.locations = locs;
  }

  // Age
  if (fbTargeting.age_min) targeting.ageMin = fbTargeting.age_min;
  if (fbTargeting.age_max) targeting.ageMax = fbTargeting.age_max;

  // Genders (Facebook: 1=male, 2=female)
  if (fbTargeting.genders) {
    targeting.genders = fbTargeting.genders.map(g =>
      g === 1 ? "male" : g === 2 ? "female" : String(g)
    );
  }

  // Interests
  if (fbTargeting.flexible_spec) {
    const interests = [];
    for (const spec of fbTargeting.flexible_spec) {
      if (spec.interests) {
        interests.push(...spec.interests.map(i => i.name));
      }
    }
    if (interests.length) targeting.interests = interests;
  }

  return targeting;
}

/**
 * Convert Facebook budget from cents to dollars/pesos
 */
function budgetFromCents(value) {
  if (value === undefined || value === null) return undefined;
  return Number(value) / 100;
}

// ---------- sync functions ----------

/**
 * Sync campaigns from Facebook
 */
async function syncCampaigns() {
  console.log("🔄 Syncing campaigns from Facebook...");

  const fbCampaigns = await fetchAllPages(
    `${AD_ACCOUNT_ID}/campaigns`,
    { fields: "name,status,objective,daily_budget,lifetime_budget,start_time,stop_time" }
  );

  console.log(`📋 Found ${fbCampaigns.length} campaigns on Facebook`);

  let created = 0;
  let updated = 0;

  for (const fb of fbCampaigns) {
    try {
      const existing = await Campaign.findOne({ fbCampaignId: fb.id });

      const updateFields = {
        name: fb.name,
        status: fb.status,
        objective: fb.objective,
        dailyBudget: budgetFromCents(fb.daily_budget),
        lifetimeBudget: budgetFromCents(fb.lifetime_budget),
        startDate: fb.start_time ? new Date(fb.start_time) : undefined,
        endDate: fb.stop_time ? new Date(fb.stop_time) : undefined,
        fbAdAccountId: AD_ACCOUNT_ID
      };

      // Remove undefined values so we don't null out fields
      Object.keys(updateFields).forEach(k => {
        if (updateFields[k] === undefined) delete updateFields[k];
      });

      if (existing) {
        await Campaign.updateOne({ _id: existing._id }, { $set: updateFields });
        updated++;
      } else {
        // New campaign — also set ref and trafficSource
        const ref = await uniqueRef(slugify(fb.name));
        await Campaign.create({
          ...updateFields,
          fbCampaignId: fb.id,
          ref,
          trafficSource: "facebook_ad"
        });
        created++;
        console.log(`  ✅ Created campaign: ${fb.name} (ref: ${ref})`);
      }
    } catch (err) {
      console.error(`  ❌ Error syncing campaign "${fb.name}": ${err.message}`);
    }
  }

  console.log(`✅ Campaigns synced — created: ${created}, updated: ${updated}`);
  return { created, updated };
}

/**
 * Sync ad sets from Facebook
 */
async function syncAdSets() {
  console.log("🔄 Syncing ad sets from Facebook...");

  const fbAdSets = await fetchAllPages(
    `${AD_ACCOUNT_ID}/adsets`,
    {
      fields: "name,status,campaign_id,targeting,daily_budget,lifetime_budget,start_time,end_time,optimization_goal,billing_event,bid_amount"
    }
  );

  console.log(`📋 Found ${fbAdSets.length} ad sets on Facebook`);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const fb of fbAdSets) {
    try {
      // Find parent campaign by Facebook campaign ID
      const parentCampaign = await Campaign.findOne({ fbCampaignId: fb.campaign_id });
      if (!parentCampaign) {
        console.log(`  ⚠️ Skipping ad set "${fb.name}" — parent campaign ${fb.campaign_id} not found`);
        skipped++;
        continue;
      }

      const existing = await AdSet.findOne({ fbAdSetId: fb.id });

      const targeting = extractTargeting(fb.targeting);

      const updateFields = {
        name: fb.name,
        status: fb.status,
        campaignId: parentCampaign._id,
        dailyBudget: budgetFromCents(fb.daily_budget),
        lifetimeBudget: budgetFromCents(fb.lifetime_budget),
        startTime: fb.start_time ? new Date(fb.start_time) : undefined,
        endTime: fb.end_time ? new Date(fb.end_time) : undefined,
        optimizationGoal: fb.optimization_goal,
        billingEvent: fb.billing_event,
        bidAmount: budgetFromCents(fb.bid_amount)
      };

      // Only set targeting fields that we actually extracted
      if (Object.keys(targeting).length > 0) {
        updateFields.targeting = targeting;
      }

      // Extract placements if present
      if (fb.targeting?.publisher_platforms) {
        updateFields.placements = fb.targeting.publisher_platforms;
      }

      // Remove undefined values
      Object.keys(updateFields).forEach(k => {
        if (updateFields[k] === undefined) delete updateFields[k];
      });

      if (existing) {
        await AdSet.updateOne({ _id: existing._id }, { $set: updateFields });
        updated++;
      } else {
        await AdSet.create({
          ...updateFields,
          fbAdSetId: fb.id
        });
        created++;
        console.log(`  ✅ Created ad set: ${fb.name}`);
      }
    } catch (err) {
      console.error(`  ❌ Error syncing ad set "${fb.name}": ${err.message}`);
      skipped++;
    }
  }

  console.log(`✅ Ad sets synced — created: ${created}, updated: ${updated}, skipped: ${skipped}`);
  return { created, updated, skipped };
}

/**
 * Sync ads from Facebook
 */
async function syncAds() {
  console.log("🔄 Syncing ads from Facebook...");

  const fbAds = await fetchAllPages(
    `${AD_ACCOUNT_ID}/ads`,
    {
      fields: "name,status,adset_id,creative{title,body,call_to_action_type,object_story_spec,image_url,video_id,thumbnail_url,link_url}"
    }
  );

  console.log(`📋 Found ${fbAds.length} ads on Facebook`);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const fb of fbAds) {
    try {
      // Find parent ad set by Facebook ad set ID
      const parentAdSet = await AdSet.findOne({ fbAdSetId: fb.adset_id });
      if (!parentAdSet) {
        console.log(`  ⚠️ Skipping ad "${fb.name}" — parent ad set ${fb.adset_id} not found`);
        skipped++;
        continue;
      }

      const existing = await Ad.findOne({ fbAdId: fb.id });

      // Extract creative data
      const creative = {};
      if (fb.creative) {
        if (fb.creative.title) creative.headline = fb.creative.title;
        if (fb.creative.body) creative.body = fb.creative.body;
        if (fb.creative.description) creative.description = fb.creative.description;
        if (fb.creative.call_to_action_type) creative.callToAction = fb.creative.call_to_action_type;
        if (fb.creative.link_url) creative.linkUrl = fb.creative.link_url;
        if (fb.creative.image_url) creative.imageUrl = fb.creative.image_url;
        if (fb.creative.thumbnail_url) creative.thumbnailUrl = fb.creative.thumbnail_url;

        // Try to get video URL from object_story_spec
        if (fb.creative.object_story_spec?.video_data?.video_id) {
          creative.videoUrl = `https://www.facebook.com/video/${fb.creative.object_story_spec.video_data.video_id}`;
        } else if (fb.creative.video_id) {
          creative.videoUrl = `https://www.facebook.com/video/${fb.creative.video_id}`;
        }
      }

      const updateFields = {
        name: fb.name,
        status: fb.status,
        adSetId: parentAdSet._id
      };

      // Only set creative if we extracted any data
      if (Object.keys(creative).length > 0) {
        updateFields.creative = creative;
      }

      // Remove undefined values
      Object.keys(updateFields).forEach(k => {
        if (updateFields[k] === undefined) delete updateFields[k];
      });

      if (existing) {
        // For existing ads with creative, merge rather than replace to preserve cards etc.
        if (updateFields.creative) {
          const mergedCreative = { ...existing.creative?.toObject?.() || {}, ...updateFields.creative };
          updateFields.creative = mergedCreative;
        }
        await Ad.updateOne({ _id: existing._id }, { $set: updateFields });
        updated++;
      } else {
        await Ad.create({
          ...updateFields,
          fbAdId: fb.id
        });
        created++;
        console.log(`  ✅ Created ad: ${fb.name}`);
      }
    } catch (err) {
      console.error(`  ❌ Error syncing ad "${fb.name}": ${err.message}`);
      skipped++;
    }
  }

  console.log(`✅ Ads synced — created: ${created}, updated: ${updated}, skipped: ${skipped}`);
  return { created, updated, skipped };
}

// ---------- metrics sync ----------

/**
 * Sync Facebook Insights metrics for campaigns, ad sets, and ads
 */
async function syncMetrics() {
  console.log("🔄 Syncing metrics from Facebook Insights...");

  const levels = ["campaign", "adset", "ad"];
  const insightsFields = "impressions,clicks,spend,reach,ctr,cpc,cpm,actions";
  const results = {};

  for (const level of levels) {
    console.log(`  📊 Fetching ${level}-level insights...`);

    let insights;
    try {
      insights = await fetchAllPages(
        `${AD_ACCOUNT_ID}/insights`,
        {
          fields: insightsFields,
          level,
          date_preset: "last_30d"
        }
      );
    } catch (err) {
      const fbErr = err.response?.data?.error;
      if (fbErr?.code === 4 || err.response?.status === 429) {
        console.log(`  ⚠️ Rate limited on ${level} insights — skipping`);
        results[level] = { fetched: 0, updated: 0, skipped: true };
        continue;
      }
      console.error(`  ❌ Error fetching ${level} insights: ${fbErr?.message || err.message}`);
      results[level] = { fetched: 0, updated: 0, error: fbErr?.message || err.message };
      continue;
    }

    let updated = 0;

    for (const row of insights) {
      const metricsUpdate = {
        "metrics.impressions": parseInt(row.impressions) || 0,
        "metrics.clicks": parseInt(row.clicks) || 0,
        "metrics.spend": parseFloat(row.spend) || 0,
        "metrics.reach": parseInt(row.reach) || 0,
        "metrics.ctr": parseFloat(row.ctr) || 0,
        "metrics.cpc": parseFloat(row.cpc) || 0,
        "metrics.cpm": parseFloat(row.cpm) || 0,
        "metrics.lastUpdated": new Date()
      };

      // Extract conversions from actions array if present
      if (row.actions) {
        const conversions = row.actions.find(
          a => a.action_type === "offsite_conversion" || a.action_type === "lead"
        );
        if (conversions) {
          metricsUpdate["metrics.conversions"] = parseInt(conversions.value) || 0;
        }
      }

      let result;
      if (level === "campaign") {
        result = await Campaign.updateOne(
          { fbCampaignId: row.campaign_id },
          { $set: metricsUpdate }
        );
      } else if (level === "adset") {
        result = await AdSet.updateOne(
          { fbAdSetId: row.adset_id },
          { $set: metricsUpdate }
        );
      } else if (level === "ad") {
        result = await Ad.updateOne(
          { fbAdId: row.ad_id },
          { $set: metricsUpdate }
        );
      }

      if (result?.modifiedCount > 0) updated++;
    }

    results[level] = { fetched: insights.length, updated };
    console.log(`  ✅ ${level} metrics — fetched: ${insights.length}, updated: ${updated}`);
  }

  console.log("✅ Metrics sync complete");
  return results;
}

// ---------- public API ----------

/**
 * Sync the full campaign hierarchy: campaigns → ad sets → ads
 */
async function syncCampaignHierarchy() {
  const campaigns = await syncCampaigns();
  const adSets = await syncAdSets();
  const ads = await syncAds();
  return { campaigns, adSets, ads };
}

/**
 * Sync everything: hierarchy + metrics
 */
async function syncAll() {
  const hierarchy = await syncCampaignHierarchy();
  const metrics = await syncMetrics();
  return { ...hierarchy, metrics };
}

module.exports = {
  syncCampaigns: syncCampaignHierarchy,
  syncMetrics,
  syncAll
};
