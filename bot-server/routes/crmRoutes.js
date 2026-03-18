// routes/crmRoutes.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const ClickLog = require('../models/ClickLog');
const ProductFamily = require('../models/ProductFamily');
const ZipCode = require('../models/ZipCode');
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

// GET /crm/customers - Manually-added customers only
router.get('/customers', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 30,
      search = '',
      sort = 'name'
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    // Only show conversations where CRM data was manually entered
    const match = {
      $or: [
        { crmName: { $exists: true, $nin: [null, ''] } },
        { crmPhone: { $exists: true, $nin: [null, ''] } },
        { crmEmail: { $exists: true, $nin: [null, ''] } }
      ]
    };

    if (search) {
      const regex = { $regex: search, $options: 'i' };
      match.$and = [
        { $or: [
          { crmName: regex },
          { crmPhone: regex },
          { crmEmail: regex },
          { city: regex }
        ]}
      ];
    }

    const sortMap = {
      name: { crmName: 1 },
      lastContact: { lastMessageAt: -1 },
      city: { city: 1 }
    };
    const sortStage = sortMap[sort] || sortMap.name;

    const [customersRaw, total] = await Promise.all([
      Conversation.find(match)
        .select('psid crmName crmPhone crmEmail city stateMx zipCode channel tags lastMessageAt')
        .sort(sortStage)
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      Conversation.countDocuments(match)
    ]);

    // Extrapolate city/state from zip code when missing
    const customers = await Promise.all(customersRaw.map(async (c) => {
      if (!c.city && c.zipCode) {
        const loc = await ZipCode.lookup(c.zipCode);
        if (loc) {
          c.city = loc.city;
          c.stateMx = loc.state;
        }
      }
      return c;
    }));

    res.json({
      success: true,
      customers,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Error fetching CRM customers:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /crm/sales - All sales (ML + manual)
router.get('/sales', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 30,
      search = '',
      source = '',  // 'ml' or 'manual' or '' (all)
      sort = 'newest'
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    const match = { converted: true };

    if (source === 'manual') {
      match.correlationMethod = 'manual';
    } else if (source === 'ml') {
      match.correlationMethod = { $ne: 'manual' };
    }

    if (search) {
      const regex = { $regex: search, $options: 'i' };
      match.$or = [
        { productName: regex },
        { 'conversionData.buyerFirstName': regex },
        { 'conversionData.buyerLastName': regex },
        { 'conversionData.buyerNickname': regex },
        { userName: regex },
        { city: regex }
      ];
    }

    const sortMap = {
      newest: { convertedAt: -1 },
      oldest: { convertedAt: 1 },
      amount: { 'conversionData.totalAmount': -1 },
      product: { productName: 1 }
    };
    const sortStage = sortMap[sort] || sortMap.newest;

    const [sales, total, totals] = await Promise.all([
      ClickLog.find(match)
        .select('clickId psid productName correlationMethod convertedAt city stateMx conversionData.totalAmount conversionData.itemTitle conversionData.buyerFirstName conversionData.buyerLastName conversionData.buyerNickname conversionData.manualNotes conversionData.orderStatus userName')
        .sort(sortStage)
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      ClickLog.countDocuments(match),
      ClickLog.aggregate([
        { $match: { converted: true } },
        { $group: {
          _id: null,
          totalRevenue: { $sum: { $ifNull: ['$conversionData.totalAmount', 0] } },
          totalSales: { $sum: 1 },
          mlSales: { $sum: { $cond: [{ $ne: ['$correlationMethod', 'manual'] }, 1, 0] } },
          manualSales: { $sum: { $cond: [{ $eq: ['$correlationMethod', 'manual'] }, 1, 0] } }
        }}
      ])
    ]);

    res.json({
      success: true,
      sales,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum)
      },
      totals: totals[0] || { totalRevenue: 0, totalSales: 0, mlSales: 0, manualSales: 0 }
    });
  } catch (error) {
    console.error('Error fetching CRM sales:', error);
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

// DELETE /crm/customers/:psid - Clear CRM data (super_admin only)
router.delete('/customers/:psid', async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, error: 'Only super_admin can delete customers' });
    }
    const { psid } = req.params;
    const conv = await Conversation.findOneAndUpdate(
      { psid },
      { $set: { crmName: null, crmPhone: null, crmEmail: null } },
      { new: true }
    );
    if (!conv) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting customer CRM data:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /crm/customers - Create customer (add CRM data to existing or new conversation)
router.post('/customers', async (req, res) => {
  try {
    const { psid, crmName, crmPhone, crmEmail, zipCode } = req.body;
    if (!crmName?.trim() && !crmPhone?.trim() && !crmEmail?.trim()) {
      return res.status(400).json({ success: false, error: 'At least one field (name, phone, or email) is required' });
    }

    const update = {};
    if (crmName?.trim()) update.crmName = crmName.trim();
    if (crmPhone?.trim()) update.crmPhone = crmPhone.trim();
    if (crmEmail?.trim()) update.crmEmail = crmEmail.trim();
    if (zipCode?.trim()) update.zipCode = zipCode.trim();

    // If psid provided, update existing conversation; otherwise create a placeholder
    const identifier = psid?.trim() || `manual:${Date.now()}`;
    const conv = await Conversation.findOneAndUpdate(
      { psid: identifier },
      { $set: update },
      { new: true, upsert: true }
    );

    res.json({ success: true, customer: conv });
  } catch (error) {
    console.error('Error creating customer:', error);
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

// GET /crm/products - Autocomplete product names (full inherited names from ProductFamily)
router.get('/products', async (req, res) => {
  try {
    const sellable = await ProductFamily.find({ sellable: true, active: true })
      .populate('parentId')
      .sort({ name: 1 })
      .lean();

    // Build full inherited names by walking the parent chain
    const names = await Promise.all(sellable.map(async (product) => {
      const hierarchy = [];
      let current = product;
      while (current) {
        hierarchy.unshift(current.name);
        if (current.parentId) {
          if (typeof current.parentId === 'object' && current.parentId.name) {
            current = current.parentId;
          } else {
            current = await ProductFamily.findById(current.parentId).lean();
          }
        } else {
          current = null;
        }
      }
      return hierarchy.join(' - ');
    }));

    const unique = [...new Set(names)].sort();
    res.json({ success: true, products: unique });
  } catch (error) {
    console.error('Error fetching product names:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
