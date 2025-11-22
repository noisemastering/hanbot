// routes/usersRoutes.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');

// GET /users - Get all Facebook/WhatsApp users
router.get('/', async (req, res) => {
  try {
    const users = await User.find()
      .sort({ last_interaction: -1 })
      .lean();

    res.json({
      success: true,
      data: users
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch users'
    });
  }
});

// GET /users/:psid - Get specific user
router.get('/:psid', async (req, res) => {
  try {
    const user = await User.findOne({ psid: req.params.psid }).lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user'
    });
  }
});

module.exports = router;
