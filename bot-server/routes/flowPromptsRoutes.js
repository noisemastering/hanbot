const express = require('express');
const router = express.Router();
const FlowPrompt = require('../models/FlowPrompt');
const { invalidateCache } = require('../ai/utils/promptLoader');

// GET all prompts (grouped by flow)
router.get('/', async (req, res) => {
  try {
    const prompts = await FlowPrompt.find({}).sort({ flow: 1, key: 1 }).lean();

    // Group by flow
    const grouped = {};
    for (const p of prompts) {
      if (!grouped[p.flow]) grouped[p.flow] = [];
      grouped[p.flow].push(p);
    }

    res.json({ success: true, data: grouped });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET single prompt
router.get('/:id', async (req, res) => {
  try {
    const prompt = await FlowPrompt.findById(req.params.id).lean();
    if (!prompt) return res.status(404).json({ success: false, error: 'Prompt no encontrado' });
    res.json({ success: true, data: prompt });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT update prompt text
router.put('/:id', async (req, res) => {
  try {
    const { prompt: promptText } = req.body;
    if (!promptText?.trim()) {
      return res.status(400).json({ success: false, error: 'El prompt no puede estar vacío' });
    }

    const doc = await FlowPrompt.findByIdAndUpdate(
      req.params.id,
      { $set: { prompt: promptText.trim(), updatedAt: new Date(), updatedBy: req.user?.email || 'dashboard' } },
      { new: true }
    );

    if (!doc) return res.status(404).json({ success: false, error: 'Prompt no encontrado' });

    // Invalidate cache so the flow picks up the new prompt immediately
    invalidateCache(doc.flow, doc.key);

    res.json({ success: true, data: doc });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
