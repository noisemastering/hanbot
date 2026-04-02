const express = require("express");
const router = express.Router();
const ConvoFlowManifest = require("../models/ConvoFlowManifest");
const convoFlow = require("../ai/flows/convoFlow");

// GET all convo_flows
router.get("/", async (req, res) => {
  try {
    const filter = {};
    if (req.query.active === 'true') filter.active = true;
    const flows = await ConvoFlowManifest.find(filter)
      .populate("products", "name")
      .sort({ displayName: 1 });
    res.json({ success: true, data: flows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET single
router.get("/:id", async (req, res) => {
  try {
    const flow = await ConvoFlowManifest.findById(req.params.id)
      .populate("products", "name");
    if (!flow) return res.status(404).json({ success: false, error: "Flujo no encontrado" });
    res.json({ success: true, data: flow });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST create
router.post("/", async (req, res) => {
  try {
    // Auto-generate name from displayName if not provided
    if (!req.body.name && req.body.displayName) {
      req.body.name = 'convo_' + req.body.displayName
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');
    }

    const flow = new ConvoFlowManifest(req.body);
    await flow.save();

    // Register in runtime if active
    if (flow.active && !flow.hasCustomHandler) {
      const instance = convoFlow.create(flow.toObject());
      convoFlow.registerFlow(flow.name, {
        manifest: flow.toObject(),
        handle: instance.handle,
        getProductCache: instance.getProductCache
      });
      console.log(`✅ Registered new convo_flow from DB: ${flow.name}`);
    }

    res.status(201).json({ success: true, data: flow });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// PUT update
router.put("/:id", async (req, res) => {
  try {
    const flow = await ConvoFlowManifest.findByIdAndUpdate(
      req.params.id, req.body, { new: true, runValidators: true }
    ).populate("products", "name");

    if (!flow) return res.status(404).json({ success: false, error: "Flujo no encontrado" });

    // Re-register in runtime if active and no custom handler
    if (flow.active && !flow.hasCustomHandler) {
      const instance = convoFlow.create(flow.toObject());
      convoFlow.registerFlow(flow.name, {
        manifest: flow.toObject(),
        handle: instance.handle,
        getProductCache: instance.getProductCache
      });
      console.log(`🔄 Re-registered convo_flow: ${flow.name}`);
    }

    res.json({ success: true, data: flow });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// DELETE
router.delete("/:id", async (req, res) => {
  try {
    const flow = await ConvoFlowManifest.findByIdAndDelete(req.params.id);
    if (!flow) return res.status(404).json({ success: false, error: "Flujo no encontrado" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
