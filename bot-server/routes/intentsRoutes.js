// routes/intentsRoutes.js
const express = require("express");
const router = express.Router();
const Intent = require("../models/Intent");

// List all intents (with optional category filter)
router.get("/", async (req, res) => {
  try {
    const { category, active } = req.query;
    const filter = {};

    if (category) {
      filter.category = category;
    }
    if (active !== undefined) {
      filter.active = active === 'true';
    }

    const intents = await Intent.find(filter)
      .sort({ priority: -1, name: 1 });
    res.json({ success: true, data: intents });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get single intent by ID
router.get("/:id", async (req, res) => {
  try {
    const intent = await Intent.findById(req.params.id);
    if (!intent) {
      return res.status(404).json({ success: false, error: "Intent no encontrado" });
    }
    res.json({ success: true, data: intent });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create new intent
router.post("/", async (req, res) => {
  try {
    const intent = new Intent(req.body);
    await intent.save();

    // Clear classifier cache when intent is created
    const { clearIntentCache } = require("../ai/classifier/intentClassifier");
    clearIntentCache();

    res.status(201).json({ success: true, data: intent });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, error: "Ya existe un intent con esa key" });
    }
    res.status(400).json({ success: false, error: err.message });
  }
});

// Update intent
router.put("/:id", async (req, res) => {
  try {
    const intent = await Intent.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!intent) {
      return res.status(404).json({ success: false, error: "Intent no encontrado" });
    }

    // Clear classifier cache when intent is updated
    const { clearIntentCache } = require("../ai/classifier/intentClassifier");
    clearIntentCache();

    res.json({ success: true, data: intent });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, error: "Ya existe un intent con esa key" });
    }
    res.status(400).json({ success: false, error: err.message });
  }
});

// Delete intent
router.delete("/:id", async (req, res) => {
  try {
    const intent = await Intent.findByIdAndDelete(req.params.id);
    if (!intent) {
      return res.status(404).json({ success: false, error: "Intent no encontrado" });
    }

    // Clear classifier cache when intent is deleted
    const { clearIntentCache } = require("../ai/classifier/intentClassifier");
    clearIntentCache();

    res.json({ success: true, message: "Intent eliminado correctamente" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Export all intents as JSON (for backup)
router.get("/actions/export", async (req, res) => {
  try {
    const intents = await Intent.find({}).lean();

    // Remove MongoDB-specific fields for cleaner export
    const cleanIntents = intents.map(({ _id, __v, createdAt, updatedAt, hitCount, lastTriggered, ...rest }) => rest);

    res.json({
      success: true,
      exportedAt: new Date().toISOString(),
      count: cleanIntents.length,
      data: cleanIntents
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Import intents from JSON
router.post("/actions/import", async (req, res) => {
  try {
    const { data, overwrite = false } = req.body;

    if (!Array.isArray(data)) {
      return res.status(400).json({ success: false, error: "data debe ser un array de intents" });
    }

    const results = {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: []
    };

    for (const intentData of data) {
      try {
        const existing = await Intent.findOne({ key: intentData.key });

        if (existing) {
          if (overwrite) {
            await Intent.findOneAndUpdate({ key: intentData.key }, intentData);
            results.updated++;
          } else {
            results.skipped++;
          }
        } else {
          await Intent.create(intentData);
          results.created++;
        }
      } catch (err) {
        results.errors.push({ key: intentData.key, error: err.message });
      }
    }

    // Clear classifier cache after import
    const { clearIntentCache } = require("../ai/classifier/intentClassifier");
    clearIntentCache();

    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Increment hit count for an intent (called when intent is triggered)
router.post("/:id/hit", async (req, res) => {
  try {
    const intent = await Intent.findByIdAndUpdate(
      req.params.id,
      {
        $inc: { hitCount: 1 },
        lastTriggered: new Date()
      },
      { new: true }
    );
    if (!intent) {
      return res.status(404).json({ success: false, error: "Intent no encontrado" });
    }
    res.json({ success: true, data: intent });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
