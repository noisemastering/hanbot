// utils/crossSellMiner.js
// Co-purchase pattern mining — analyzes MLOrder history to find products
// that are frequently bought together (within same order or by same customer).
// Uses association rules (support + confidence) rather than KNN for cleaner results.

const MLOrder = require('../models/MLOrder');
const CrossSellRule = require('../models/CrossSellRule');
const ProductFamily = require('../models/ProductFamily');

// In-memory progress tracking
const progressMap = new Map();

/**
 * Mine co-purchase patterns from MLOrder history.
 *
 * Two passes:
 * 1. Within-order: products in the same order (strongest signal)
 * 2. Cross-order: products bought by same buyer within a time window (weaker but broader)
 *
 * Outputs ranked product pairs with support and confidence metrics.
 *
 * @param {Object} options
 * @param {number} options.minSupport - Minimum number of co-occurrences to consider (default: 3)
 * @param {number} options.minConfidence - Minimum confidence 0-1 (default: 0.05)
 * @param {number} options.crossOrderWindowDays - Days to look across orders per buyer (default: 90)
 * @param {boolean} options.autoCreate - Auto-create CrossSellRule suggestions (default: false)
 * @returns {Promise<Object>} Mining results
 */
async function minePatterns(options = {}) {
  const {
    minSupport = 3,
    minConfidence = 0.05,
    crossOrderWindowDays = 90,
    autoCreate = false
  } = options;

  const progressKey = 'mining';
  const progress = {
    status: 'running',
    phase: 'loading',
    startedAt: new Date(),
    ordersAnalyzed: 0,
    buyersAnalyzed: 0,
    pairsFound: 0
  };
  progressMap.set(progressKey, progress);

  try {
    // ── PHASE 1: Load product family names for labeling ──
    progress.phase = 'loading_families';
    const allFamilies = await ProductFamily.find({}).select('name parentId sellable').lean();
    const familyMap = new Map(allFamilies.map(f => [String(f._id), f]));

    const getFamilyLabel = (id) => {
      const fam = familyMap.get(String(id));
      if (!fam) return String(id);
      // Walk up to get path
      const parts = [fam.name];
      let current = fam;
      while (current?.parentId) {
        const parent = familyMap.get(String(current.parentId));
        if (parent) { parts.unshift(parent.name); current = parent; }
        else break;
      }
      return parts.join(' > ');
    };

    // ── PHASE 2: Within-order co-purchases ──
    progress.phase = 'within_order';
    console.log('🔍 Mining within-order co-purchases...');

    // Find orders with mapped products (need productFamilyId)
    const withinOrderPairs = {};
    const productOrderCounts = {}; // How many orders contain each product

    const orderCursor = MLOrder.find({
      status: 'paid',
      'items.productFamilyId': { $ne: null }
    }).select('items').lean().cursor();

    let orderCount = 0;
    for await (const order of orderCursor) {
      // Get unique product family IDs in this order
      const productIds = [...new Set(
        order.items
          .filter(i => i.productFamilyId)
          .map(i => String(i.productFamilyId))
      )];

      // Count single product occurrences
      for (const pid of productIds) {
        productOrderCounts[pid] = (productOrderCounts[pid] || 0) + 1;
      }

      // Generate pairs (if order has 2+ distinct products)
      if (productIds.length >= 2) {
        for (let i = 0; i < productIds.length; i++) {
          for (let j = i + 1; j < productIds.length; j++) {
            const key = [productIds[i], productIds[j]].sort().join('|');
            if (!withinOrderPairs[key]) {
              withinOrderPairs[key] = { a: productIds[i], b: productIds[j], count: 0, source: 'within_order' };
            }
            withinOrderPairs[key].count++;
          }
        }
      }

      orderCount++;
      if (orderCount % 10000 === 0) {
        progress.ordersAnalyzed = orderCount;
        console.log(`  📦 Analyzed ${orderCount} orders...`);
      }
    }

    progress.ordersAnalyzed = orderCount;
    console.log(`  ✅ Within-order: ${Object.keys(withinOrderPairs).length} unique pairs from ${orderCount} orders`);

    // ── PHASE 3: Cross-order co-purchases (same buyer, different orders) ──
    progress.phase = 'cross_order';
    console.log('🔍 Mining cross-order co-purchases...');

    const crossOrderPairs = {};
    const windowMs = crossOrderWindowDays * 24 * 60 * 60 * 1000;

    // Group orders by buyer
    const buyerOrders = await MLOrder.aggregate([
      { $match: { status: 'paid', 'buyer.mlBuyerId': { $exists: true, $ne: '' }, 'items.productFamilyId': { $ne: null } } },
      { $group: {
        _id: '$buyer.mlBuyerId',
        orders: { $push: { date: '$dateCreated', items: '$items' } },
        orderCount: { $sum: 1 }
      }},
      { $match: { orderCount: { $gte: 2 } } } // Only buyers with 2+ orders
    ]);

    let buyerCount = 0;
    for (const buyer of buyerOrders) {
      const orders = buyer.orders.sort((a, b) => new Date(a.date) - new Date(b.date));

      // For each pair of orders within the time window
      for (let i = 0; i < orders.length; i++) {
        for (let j = i + 1; j < orders.length; j++) {
          const timeDiff = Math.abs(new Date(orders[j].date) - new Date(orders[i].date));
          if (timeDiff > windowMs) continue;

          const productsI = [...new Set(orders[i].items.filter(it => it.productFamilyId).map(it => String(it.productFamilyId)))];
          const productsJ = [...new Set(orders[j].items.filter(it => it.productFamilyId).map(it => String(it.productFamilyId)))];

          // Cross-pair: products from order i with products from order j
          for (const pi of productsI) {
            for (const pj of productsJ) {
              if (pi === pj) continue; // Skip same product
              const key = [pi, pj].sort().join('|');
              if (!crossOrderPairs[key]) {
                crossOrderPairs[key] = { a: pi, b: pj, count: 0, source: 'cross_order' };
              }
              crossOrderPairs[key].count++;
            }
          }
        }
      }

      buyerCount++;
      if (buyerCount % 1000 === 0) {
        progress.buyersAnalyzed = buyerCount;
      }
    }

    progress.buyersAnalyzed = buyerCount;
    console.log(`  ✅ Cross-order: ${Object.keys(crossOrderPairs).length} unique pairs from ${buyerCount} repeat buyers`);

    // ── PHASE 4: Merge and rank ──
    progress.phase = 'ranking';
    console.log('📊 Ranking pairs...');

    const totalOrders = orderCount;
    const allPairs = {};

    // Merge within-order (higher weight)
    for (const [key, pair] of Object.entries(withinOrderPairs)) {
      if (pair.count >= minSupport) {
        allPairs[key] = {
          ...pair,
          withinOrderCount: pair.count,
          crossOrderCount: 0
        };
      }
    }

    // Merge cross-order
    for (const [key, pair] of Object.entries(crossOrderPairs)) {
      if (allPairs[key]) {
        allPairs[key].crossOrderCount = pair.count;
        allPairs[key].count += pair.count;
      } else if (pair.count >= minSupport) {
        allPairs[key] = {
          ...pair,
          withinOrderCount: 0,
          crossOrderCount: pair.count
        };
      }
    }

    // Calculate confidence and support for each pair
    const rankedPairs = Object.values(allPairs)
      .map(pair => {
        const countA = productOrderCounts[pair.a] || 1;
        const countB = productOrderCounts[pair.b] || 1;

        // Confidence A→B: P(B|A) = count(A∧B) / count(A)
        const confidenceAtoB = pair.count / countA;
        // Confidence B→A: P(A|B) = count(A∧B) / count(B)
        const confidenceBtoA = pair.count / countB;

        // Support: what fraction of all orders contain this pair
        const support = pair.count / totalOrders;

        // Lift: how much more likely they co-occur vs random
        const lift = (pair.count * totalOrders) / (countA * countB);

        // Score: weighted combination (within-order pairs get bonus)
        const withinBonus = pair.withinOrderCount > 0 ? 1.5 : 1;
        const score = (Math.max(confidenceAtoB, confidenceBtoA) * lift * withinBonus);

        // Direction: recommend the less common product to buyers of the more common one
        const sourceId = countA >= countB ? pair.a : pair.b;
        const targetId = countA >= countB ? pair.b : pair.a;
        const confidence = countA >= countB ? confidenceAtoB : confidenceBtoA;

        return {
          sourceId,
          targetId,
          sourceLabel: getFamilyLabel(sourceId),
          targetLabel: getFamilyLabel(targetId),
          coOccurrences: pair.count,
          withinOrderCount: pair.withinOrderCount,
          crossOrderCount: pair.crossOrderCount,
          sourceOrders: Math.max(countA, countB),
          targetOrders: Math.min(countA, countB),
          confidence: +confidence.toFixed(4),
          support: +support.toFixed(6),
          lift: +lift.toFixed(2),
          score: +score.toFixed(3)
        };
      })
      .filter(p => p.confidence >= minConfidence)
      .sort((a, b) => b.score - a.score);

    progress.pairsFound = rankedPairs.length;
    console.log(`  ✅ ${rankedPairs.length} pairs above threshold (min support: ${minSupport}, min confidence: ${(minConfidence * 100).toFixed(0)}%)`);

    // ── PHASE 5: Auto-create suggestions (if enabled) ──
    let created = 0;
    if (autoCreate && rankedPairs.length > 0) {
      progress.phase = 'creating_rules';
      console.log('💾 Creating cross-sell suggestions...');

      for (const pair of rankedPairs.slice(0, 50)) { // Top 50 only
        try {
          const existing = await CrossSellRule.findOne({
            sourceProductFamilyId: pair.sourceId,
            targetProductFamilyId: pair.targetId
          });

          if (!existing) {
            await CrossSellRule.create({
              source: 'mined',
              name: `${pair.sourceLabel.split(' > ').pop()} → ${pair.targetLabel.split(' > ').pop()}`,
              sourceProductFamilyId: pair.sourceId,
              targetProductFamilyId: pair.targetId,
              triggerType: pair.withinOrderCount > pair.crossOrderCount ? 'cart_suggestion' : 'post_purchase',
              priority: Math.round(pair.score * 100),
              active: false, // Created as inactive — admin reviews and activates
              message: `Los clientes que compran ${pair.sourceLabel.split(' > ').pop()} también suelen llevar ${pair.targetLabel.split(' > ').pop()}.`,
              conditions: { minOrderAmount: 0, minQuantity: 0 },
              // Store mining metadata
              _miningData: {
                confidence: pair.confidence,
                support: pair.support,
                lift: pair.lift,
                coOccurrences: pair.coOccurrences,
                minedAt: new Date()
              }
            });
            created++;
          }
        } catch (err) {
          console.error(`  ❌ Error creating rule: ${err.message}`);
        }
      }
      console.log(`  ✅ Created ${created} new suggestions (inactive, pending review)`);
    }

    progress.status = 'completed';
    progress.completedAt = new Date();

    return {
      ordersAnalyzed: orderCount,
      repeatBuyers: buyerCount,
      withinOrderPairs: Object.keys(withinOrderPairs).length,
      crossOrderPairs: Object.keys(crossOrderPairs).length,
      qualifiedPairs: rankedPairs.length,
      rulesCreated: created,
      topPairs: rankedPairs.slice(0, 20),
      params: { minSupport, minConfidence, crossOrderWindowDays }
    };
  } catch (err) {
    progress.status = 'error';
    progress.error = err.message;
    console.error('❌ Mining error:', err.message);
    throw err;
  }
}

function getProgress(key = 'mining') {
  return progressMap.get(key) || null;
}

module.exports = { minePatterns, getProgress };
