// routes/crmRoutes.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const ClickLog = require('../models/ClickLog');
const DashboardUser = require('../models/DashboardUser');

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';

// Authentication middleware (same pattern as clickLogsRoutes)
const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ success: false, error: 'No token provided' });
    }
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await DashboardUser.findById(decoded.id).select('-password');
    if (!user || !user.active) {
      return res.status(401).json({ success: false, error: 'Invalid token or inactive user' });
    }
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
};

router.use(authenticate);

// GET /crm/customers - Aggregated customer list
router.get('/customers', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 30,
      search = '',
      channel = '',
      intent = '',
      hasConverted = '',
      sort = 'lastContact'
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    // Build match filter
    const match = {};
    if (channel) match.channel = channel;
    if (intent) match.purchaseIntent = intent;
    if (search) {
      const regex = { $regex: search, $options: 'i' };
      match.$or = [
        { 'productSpecs.customerName': regex },
        { 'leadData.name': regex },
        { city: regex },
        { psid: regex }
      ];
    }

    // Sort options
    const sortMap = {
      lastContact: { lastMessageAt: -1 },
      revenue: { totalRevenue: -1 },
      purchases: { totalPurchases: -1 },
      name: { customerName: 1 }
    };
    const sortStage = sortMap[sort] || sortMap.lastContact;

    // Main aggregation
    const pipeline = [
      { $match: match },
      {
        $lookup: {
          from: 'clicklogs',
          let: { customerPsid: '$psid' },
          pipeline: [
            { $match: { $expr: { $and: [{ $eq: ['$psid', '$$customerPsid'] }, { $eq: ['$converted', true] }] } } },
            { $group: { _id: null, count: { $sum: 1 }, revenue: { $sum: { $ifNull: ['$conversionData.totalAmount', 0] } } } }
          ],
          as: 'salesData'
        }
      },
      {
        $addFields: {
          totalPurchases: { $ifNull: [{ $arrayElemAt: ['$salesData.count', 0] }, 0] },
          totalRevenue: { $ifNull: [{ $arrayElemAt: ['$salesData.revenue', 0] }, 0] },
          customerName: {
            $ifNull: [
              '$productSpecs.customerName',
              { $ifNull: ['$leadData.name', null] }
            ]
          }
        }
      },
      { $project: { salesData: 0 } }
    ];

    // hasConverted filter (after lookup)
    if (hasConverted === 'true') {
      pipeline.push({ $match: { totalPurchases: { $gt: 0 } } });
    } else if (hasConverted === 'false') {
      pipeline.push({ $match: { totalPurchases: 0 } });
    }

    pipeline.push(
      { $sort: sortStage },
      {
        $facet: {
          data: [
            { $skip: (pageNum - 1) * limitNum },
            { $limit: limitNum },
            {
              $project: {
                psid: 1, channel: 1, city: 1, stateMx: 1,
                customerName: 1, purchaseIntent: 1,
                totalPurchases: 1, totalRevenue: 1,
                lastMessageAt: 1, tags: 1,
                handoffRequested: 1, currentFlow: 1
              }
            }
          ],
          total: [{ $count: 'count' }]
        }
      }
    );

    const [result] = await Conversation.aggregate(pipeline);
    const customers = result.data || [];
    const total = result.total[0]?.count || 0;

    // KPIs (lightweight parallel queries)
    const [totalCustomers, activeLeads, purchaseData] = await Promise.all([
      Conversation.countDocuments({}),
      Conversation.countDocuments({ purchaseIntent: 'high' }),
      ClickLog.aggregate([
        { $match: { converted: true } },
        { $group: { _id: null, uniqueCustomers: { $addToSet: '$psid' }, totalRevenue: { $sum: { $ifNull: ['$conversionData.totalAmount', 0] } } } }
      ])
    ]);

    const kpis = {
      totalCustomers,
      activeLeads,
      customersWithPurchases: purchaseData[0]?.uniqueCustomers?.length || 0,
      totalRevenue: purchaseData[0]?.totalRevenue || 0
    };

    res.json({
      success: true,
      customers,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum)
      },
      kpis
    });
  } catch (error) {
    console.error('Error fetching CRM customers:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /crm/customers/:psid - Customer detail
router.get('/customers/:psid', async (req, res) => {
  try {
    const { psid } = req.params;

    const [customer, messages, clickHistory] = await Promise.all([
      Conversation.findOne({ psid }).lean(),
      Message.find({ psid }).sort({ timestamp: -1 }).limit(100).lean(),
      ClickLog.find({ psid }).sort({ createdAt: -1 }).lean()
    ]);

    if (!customer) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }

    const purchases = clickHistory.filter(c => c.converted);

    res.json({
      success: true,
      customer,
      messages,
      clickHistory,
      purchases
    });
  } catch (error) {
    console.error('Error fetching customer detail:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /crm/customers/:psid/profile - Update customer profile
router.put('/customers/:psid/profile', async (req, res) => {
  try {
    const { psid } = req.params;
    const { crmName, crmEmail, crmPhone, zipCode } = req.body;

    const update = {};
    if (crmName !== undefined) update.crmName = crmName.trim() || null;
    if (crmEmail !== undefined) update.crmEmail = crmEmail.trim() || null;
    if (crmPhone !== undefined) update.crmPhone = crmPhone.trim() || null;
    if (zipCode !== undefined) update.zipCode = zipCode.trim() || null;

    const conv = await Conversation.findOneAndUpdate(
      { psid },
      { $set: update },
      { new: true }
    );

    if (!conv) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }

    res.json({ success: true, customer: conv });
  } catch (error) {
    console.error('Error updating customer profile:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /crm/customers/:psid/notes - Add a note
router.post('/customers/:psid/notes', async (req, res) => {
  try {
    const { psid } = req.params;
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, error: 'Note text is required' });
    }

    const author = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;
    const conv = await Conversation.findOneAndUpdate(
      { psid },
      { $push: { notes: { text: text.trim(), author, createdAt: new Date() } } },
      { new: true }
    );

    if (!conv) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }

    res.json({ success: true, notes: conv.notes });
  } catch (error) {
    console.error('Error adding note:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /crm/customers/:psid/notes/:noteId - Delete a note
router.delete('/customers/:psid/notes/:noteId', async (req, res) => {
  try {
    const { psid, noteId } = req.params;

    const conv = await Conversation.findOneAndUpdate(
      { psid },
      { $pull: { notes: { _id: noteId } } },
      { new: true }
    );

    if (!conv) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }

    res.json({ success: true, notes: conv.notes });
  } catch (error) {
    console.error('Error deleting note:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /crm/customers/:psid/tags - Add a tag
router.post('/customers/:psid/tags', async (req, res) => {
  try {
    const { psid } = req.params;
    const { tag } = req.body;

    if (!tag || !tag.trim()) {
      return res.status(400).json({ success: false, error: 'Tag is required' });
    }

    const conv = await Conversation.findOneAndUpdate(
      { psid },
      { $addToSet: { tags: tag.trim().toLowerCase() } },
      { new: true }
    );

    if (!conv) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }

    res.json({ success: true, tags: conv.tags });
  } catch (error) {
    console.error('Error adding tag:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /crm/customers/:psid/tags/:tag - Remove a tag
router.delete('/customers/:psid/tags/:tag', async (req, res) => {
  try {
    const { psid } = req.params;
    const tag = decodeURIComponent(req.params.tag);

    const conv = await Conversation.findOneAndUpdate(
      { psid },
      { $pull: { tags: tag } },
      { new: true }
    );

    if (!conv) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }

    res.json({ success: true, tags: conv.tags });
  } catch (error) {
    console.error('Error removing tag:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /crm/products - Autocomplete product names
router.get('/products', async (req, res) => {
  try {
    const { q = '' } = req.query;
    const names = await ClickLog.distinct('productName', {
      productName: { $type: 'string', $ne: '' }
    });
    const filtered = q
      ? names.filter(n => n.toLowerCase().includes(q.toLowerCase()))
      : names;
    filtered.sort();
    res.json({ success: true, products: filtered });
  } catch (error) {
    console.error('Error fetching product names:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
