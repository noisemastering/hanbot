// routes/uploadsRoutes.js
const express = require('express');
const router = express.Router();
const { uploadCatalog, deleteFile } = require('../config/cloudinary');
const Campaign = require('../models/Campaign');
const AdSet = require('../models/AdSet');
const Ad = require('../models/Ad');

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

module.exports = router;
