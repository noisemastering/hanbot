// routes/cannedMessagesRoutes.js
//
// CRUD for business-owned canned messages (saved replies). Used by the reply
// composer in the dashboard Messages view. Kept deliberately simple — a flat,
// manually-ordered list the agent can search, insert, and manage inline.
const express = require("express");
const router = express.Router();
const CannedMessage = require("../models/CannedMessage");
const { resolveCannedTokens } = require("../utils/cannedTokens");

// Resolve a message's dynamic tokens against THIS conversation + live inventory,
// right before the agent inserts it. Body may be passed directly (preview) or by id.
router.post("/resolve", async (req, res) => {
  try {
    const { psid, agentName } = req.body || {};
    let body = req.body?.body;
    if (!body && req.body?.id) {
      const doc = await CannedMessage.findById(req.body.id).lean();
      body = doc?.body || "";
    }
    let customerName = null;
    if (psid) {
      const Conversation = require("../models/Conversation");
      const c = await Conversation.findOne({ psid }).select("extractedName customerName").lean();
      customerName = c?.extractedName || c?.customerName || null;
    }
    const resolved = await resolveCannedTokens(body || "", { psid, agentName, customerName });
    res.json({ success: true, resolved });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// List all — ordered by manual `order`, then newest first.
router.get("/", async (req, res) => {
  try {
    // pinned first, then most-used (popularity), then oldest.
    const items = await CannedMessage.find({}).sort({ pinned: -1, usageCount: -1, createdAt: 1 }).lean();
    res.json({ success: true, data: items });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create.
router.post("/", async (req, res) => {
  try {
    const { title, body, category, order, createdBy, pinned, dynamic } = req.body || {};
    if (!title || !String(title).trim() || !body || !String(body).trim()) {
      return res.status(400).json({ success: false, error: "title y body son obligatorios" });
    }
    const created = await CannedMessage.create({
      title: String(title).trim(),
      body: String(body),
      category: category ? String(category).trim() : null,
      order: Number.isFinite(order) ? order : 0,
      pinned: !!pinned,
      dynamic: !!dynamic,
      createdBy: createdBy || null,
    });
    res.json({ success: true, data: created });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update.
router.put("/:id", async (req, res) => {
  try {
    const { title, body, category, order, pinned, dynamic } = req.body || {};
    const set = {};
    if (title !== undefined) set.title = String(title).trim();
    if (body !== undefined) set.body = String(body);
    if (category !== undefined) set.category = category ? String(category).trim() : null;
    if (order !== undefined) set.order = Number(order) || 0;
    if (pinned !== undefined) set.pinned = !!pinned;
    if (dynamic !== undefined) set.dynamic = !!dynamic;
    const updated = await CannedMessage.findByIdAndUpdate(req.params.id, { $set: set }, { new: true });
    if (!updated) return res.status(404).json({ success: false, error: "no encontrado" });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete.
router.delete("/:id", async (req, res) => {
  try {
    await CannedMessage.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Bump usage count when a reply is inserted (so popular ones can float up later).
router.post("/:id/used", async (req, res) => {
  try {
    await CannedMessage.updateOne({ _id: req.params.id }, { $inc: { usageCount: 1 } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
