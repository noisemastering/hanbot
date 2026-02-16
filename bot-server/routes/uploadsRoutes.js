// routes/uploadsRoutes.js
const express = require('express');
const router = express.Router();
const { uploadCatalog, deleteFile } = require('../config/cloudinary');
const Campaign = require('../models/Campaign');
const AdSet = require('../models/AdSet');
const Ad = require('../models/Ad');
const ProductFamily = require('../models/ProductFamily');

/**
 * Upload catalog for a Campaign
 * POST /uploads/catalog/campaign/:id
 */
router.post('/catalog/campaign/:id', uploadCatalog.single('catalog'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      // Delete uploaded file if campaign not found
      await deleteFile(req.file.filename);
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    // Delete old catalog if exists
    if (campaign.catalog?.publicId) {
      await deleteFile(campaign.catalog.publicId).catch(err => {
        console.warn('Could not delete old catalog:', err.message);
      });
    }

    // Update campaign with new catalog
    campaign.catalog = {
      url: req.file.path,
      publicId: req.file.filename,
      name: req.file.originalname,
      uploadedAt: new Date()
    };
    await campaign.save();

    res.json({
      success: true,
      data: {
        catalog: campaign.catalog
      }
    });
  } catch (error) {
    console.error('Error uploading catalog:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Upload catalog for an AdSet
 * POST /uploads/catalog/adset/:id
 */
router.post('/catalog/adset/:id', uploadCatalog.single('catalog'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const adSet = await AdSet.findById(req.params.id);
    if (!adSet) {
      await deleteFile(req.file.filename);
      return res.status(404).json({ success: false, error: 'AdSet not found' });
    }

    // Delete old catalog if exists
    if (adSet.catalog?.publicId) {
      await deleteFile(adSet.catalog.publicId).catch(err => {
        console.warn('Could not delete old catalog:', err.message);
      });
    }

    // Update adset with new catalog
    adSet.catalog = {
      url: req.file.path,
      publicId: req.file.filename,
      name: req.file.originalname,
      uploadedAt: new Date()
    };
    await adSet.save();

    res.json({
      success: true,
      data: {
        catalog: adSet.catalog
      }
    });
  } catch (error) {
    console.error('Error uploading catalog:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Upload catalog for an Ad
 * POST /uploads/catalog/ad/:id
 */
router.post('/catalog/ad/:id', uploadCatalog.single('catalog'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const ad = await Ad.findById(req.params.id);
    if (!ad) {
      await deleteFile(req.file.filename);
      return res.status(404).json({ success: false, error: 'Ad not found' });
    }

    // Delete old catalog if exists
    if (ad.catalog?.publicId) {
      await deleteFile(ad.catalog.publicId).catch(err => {
        console.warn('Could not delete old catalog:', err.message);
      });
    }

    // Update ad with new catalog
    ad.catalog = {
      url: req.file.path,
      publicId: req.file.filename,
      name: req.file.originalname,
      uploadedAt: new Date()
    };
    await ad.save();

    res.json({
      success: true,
      data: {
        catalog: ad.catalog
      }
    });
  } catch (error) {
    console.error('Error uploading catalog:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Delete catalog from Campaign
 * DELETE /uploads/catalog/campaign/:id
 */
router.delete('/catalog/campaign/:id', async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    if (campaign.catalog?.publicId) {
      await deleteFile(campaign.catalog.publicId);
    }

    campaign.catalog = undefined;
    await campaign.save();

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting catalog:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Delete catalog from AdSet
 * DELETE /uploads/catalog/adset/:id
 */
router.delete('/catalog/adset/:id', async (req, res) => {
  try {
    const adSet = await AdSet.findById(req.params.id);
    if (!adSet) {
      return res.status(404).json({ success: false, error: 'AdSet not found' });
    }

    if (adSet.catalog?.publicId) {
      await deleteFile(adSet.catalog.publicId);
    }

    adSet.catalog = undefined;
    await adSet.save();

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting catalog:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Delete catalog from Ad
 * DELETE /uploads/catalog/ad/:id
 */
router.delete('/catalog/ad/:id', async (req, res) => {
  try {
    const ad = await Ad.findById(req.params.id);
    if (!ad) {
      return res.status(404).json({ success: false, error: 'Ad not found' });
    }

    if (ad.catalog?.publicId) {
      await deleteFile(ad.catalog.publicId);
    }

    ad.catalog = undefined;
    await ad.save();

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting catalog:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Upload catalog for a ProductFamily
 * POST /uploads/catalog/product-family/:id
 */
router.post('/catalog/product-family/:id', uploadCatalog.single('catalog'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const family = await ProductFamily.findById(req.params.id);
    if (!family) {
      await deleteFile(req.file.filename);
      return res.status(404).json({ success: false, error: 'ProductFamily not found' });
    }

    // Delete old catalog if exists
    if (family.catalog?.publicId) {
      await deleteFile(family.catalog.publicId).catch(err => {
        console.warn('Could not delete old catalog:', err.message);
      });
    }

    // Update family with new catalog
    family.catalog = {
      url: req.file.path,
      publicId: req.file.filename,
      name: req.file.originalname,
      uploadedAt: new Date()
    };
    await family.save();

    res.json({
      success: true,
      data: {
        catalog: family.catalog
      }
    });
  } catch (error) {
    console.error('Error uploading catalog:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Delete catalog from ProductFamily
 * DELETE /uploads/catalog/product-family/:id
 */
router.delete('/catalog/product-family/:id', async (req, res) => {
  try {
    const family = await ProductFamily.findById(req.params.id);
    if (!family) {
      return res.status(404).json({ success: false, error: 'ProductFamily not found' });
    }

    // Only delete from Cloudinary if it has a publicId (owned file)
    if (family.catalog?.publicId) {
      await deleteFile(family.catalog.publicId);
    }

    family.catalog = undefined;
    await family.save();

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting catalog:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * List all existing catalogs across all entity types
 * GET /uploads/catalogs
 */
router.get('/catalogs', async (req, res) => {
  try {
    const [campaigns, adSets, ads, families] = await Promise.all([
      Campaign.find({ 'catalog.url': { $exists: true, $ne: null } }).select('name catalog').lean(),
      AdSet.find({ 'catalog.url': { $exists: true, $ne: null } }).select('name catalog').lean(),
      Ad.find({ 'catalog.url': { $exists: true, $ne: null } }).select('name catalog').lean(),
      ProductFamily.find({ 'catalog.url': { $exists: true, $ne: null }, parentId: null }).select('name catalog').lean()
    ]);

    const catalogs = [];

    families.forEach(f => {
      catalogs.push({
        url: f.catalog.url,
        name: f.catalog.name,
        uploadedAt: f.catalog.uploadedAt,
        entityType: 'Familia',
        entityName: f.name,
        entityId: f._id
      });
    });

    campaigns.forEach(c => {
      catalogs.push({
        url: c.catalog.url,
        name: c.catalog.name,
        uploadedAt: c.catalog.uploadedAt,
        entityType: 'Campaña',
        entityName: c.name,
        entityId: c._id
      });
    });

    adSets.forEach(a => {
      catalogs.push({
        url: a.catalog.url,
        name: a.catalog.name,
        uploadedAt: a.catalog.uploadedAt,
        entityType: 'AdSet',
        entityName: a.name,
        entityId: a._id
      });
    });

    ads.forEach(a => {
      catalogs.push({
        url: a.catalog.url,
        name: a.catalog.name,
        uploadedAt: a.catalog.uploadedAt,
        entityType: 'Ad',
        entityName: a.name,
        entityId: a._id
      });
    });

    // Sort by most recently uploaded
    catalogs.sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));

    res.json({ success: true, data: catalogs });
  } catch (error) {
    console.error('Error listing catalogs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Assign an existing catalog URL to an entity (no re-upload)
 * PUT /uploads/catalog/:entityType/:id
 */
router.put('/catalog/:entityType/:id', async (req, res) => {
  try {
    const { entityType, id } = req.params;
    const { url, name } = req.body;

    if (!url) {
      return res.status(400).json({ success: false, error: 'URL is required' });
    }

    const modelMap = {
      'campaign': Campaign,
      'adset': AdSet,
      'ad': Ad,
      'product-family': ProductFamily
    };

    const Model = modelMap[entityType];
    if (!Model) {
      return res.status(400).json({ success: false, error: `Invalid entity type: ${entityType}` });
    }

    const entity = await Model.findById(id);
    if (!entity) {
      return res.status(404).json({ success: false, error: `${entityType} not found` });
    }

    // If current catalog has a publicId (owned file), delete it from Cloudinary
    if (entity.catalog?.publicId) {
      await deleteFile(entity.catalog.publicId).catch(err => {
        console.warn('Could not delete old catalog:', err.message);
      });
    }

    // Set catalog without publicId (referenced, not owned)
    entity.catalog = {
      url,
      name: name || 'Catálogo',
      uploadedAt: new Date()
      // No publicId — this is a reference, not an owned file
    };
    await entity.save();

    res.json({
      success: true,
      data: {
        catalog: entity.catalog
      }
    });
  } catch (error) {
    console.error('Error assigning catalog:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Upload global catalog (stored in BusinessInfo)
 * POST /uploads/catalog/global
 */
const mongoose = require('mongoose');

router.post('/catalog/global', uploadCatalog.single('catalog'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const BizInfo = mongoose.model('BusinessInfo');
    let info = await BizInfo.findById('hanlob-info');
    if (!info) {
      info = new BizInfo({ _id: 'hanlob-info' });
    }

    // Delete old catalog if exists
    if (info.catalog?.publicId) {
      await deleteFile(info.catalog.publicId).catch(err => {
        console.warn('Could not delete old global catalog:', err.message);
      });
    }

    info.catalog = {
      url: req.file.path,
      publicId: req.file.filename,
      name: req.file.originalname,
      uploadedAt: new Date()
    };
    await info.save();

    res.json({ success: true, data: { catalog: info.catalog } });
  } catch (error) {
    console.error('Error uploading global catalog:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Delete global catalog
 * DELETE /uploads/catalog/global
 */
router.delete('/catalog/global', async (req, res) => {
  try {
    const BizInfo = mongoose.model('BusinessInfo');
    const info = await BizInfo.findById('hanlob-info');
    if (!info) {
      return res.status(404).json({ success: false, error: 'BusinessInfo not found' });
    }

    if (info.catalog?.publicId) {
      await deleteFile(info.catalog.publicId);
    }

    info.catalog = undefined;
    await info.save();

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting global catalog:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Get global catalog
 * GET /uploads/catalog/global
 */
router.get('/catalog/global', async (req, res) => {
  try {
    const BizInfo = mongoose.model('BusinessInfo');
    const info = await BizInfo.findById('hanlob-info').select('catalog').lean();

    res.json({ success: true, data: { catalog: info?.catalog || null } });
  } catch (error) {
    console.error('Error fetching global catalog:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
