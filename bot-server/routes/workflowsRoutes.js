// routes/workflowsRoutes.js
//
// Conversation Workflow API — SUPER_ADMIN ONLY.
// CRUD + JSON import + a chat-style sandbox that drives the router+node engine
// against an ephemeral in-memory conversation (never a real Meta user).
const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const Workflow = require("../models/Workflow");
const DashboardUser = require("../models/DashboardUser");
const { runWorkflowTurn, initState } = require("../ai/workflow");

const JWT_SECRET = process.env.JWT_SECRET || "your-super-secret-jwt-key-change-in-production";

// --- auth (same shape as rolesRoutes.js) ---
const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ success: false, error: "No token provided" });
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await DashboardUser.findById(decoded.id).select("-password");
    if (!user || !user.active) {
      return res.status(401).json({ success: false, error: "Invalid token or inactive user" });
    }
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ success: false, error: "Invalid or expired token" });
  }
};

const requireSuperAdmin = (req, res, next) => {
  if (req.user.role !== "super_admin") {
    return res.status(403).json({ success: false, error: "Only Super Admin can manage workflows" });
  }
  next();
};

router.use(authenticate);
router.use(requireSuperAdmin);

// --- ephemeral sandbox sessions (in-memory, lost on restart — fine for testing) ---
const sandboxSessions = new Map(); // sessionId -> { workflowId, state }

// GET /workflows
router.get("/", async (req, res) => {
  try {
    const filter = {};
    if (req.query.active === "true") filter.active = true;
    const workflows = await Workflow.find(filter).sort({ updatedAt: -1 });
    res.json({ success: true, data: workflows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /workflows/:id
router.get("/:id", async (req, res) => {
  try {
    const wf = await Workflow.findById(req.params.id);
    if (!wf) return res.status(404).json({ success: false, error: "Workflow not found" });
    res.json({ success: true, data: wf });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /workflows
router.post("/", async (req, res) => {
  try {
    const wf = new Workflow({ ...req.body, createdBy: req.user.username || req.user.email });
    await wf.save();
    res.status(201).json({ success: true, data: wf });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// POST /workflows/import — create from a full JSON definition
router.post("/import", async (req, res) => {
  try {
    const def = req.body && req.body.workflow ? req.body.workflow : req.body;
    if (!def || !def.name) {
      return res.status(400).json({ success: false, error: "Import requires a workflow with a name" });
    }
    delete def._id;
    const wf = new Workflow({ ...def, createdBy: req.user.username || req.user.email });
    await wf.save();
    res.status(201).json({ success: true, data: wf });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// PUT /workflows/:id — snapshot the previous version, then update
router.put("/:id", async (req, res) => {
  try {
    const existing = await Workflow.findById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, error: "Workflow not found" });

    const snapshot = existing.toObject();
    delete snapshot.versions; // don't nest snapshots inside snapshots
    existing.versions = existing.versions || [];
    existing.versions.push({
      version: existing.version,
      snapshot,
      savedAt: new Date(),
      savedBy: req.user.username || req.user.email,
    });

    const { versions, _id, createdAt, ...patch } = req.body;
    Object.assign(existing, patch);
    existing.version = (existing.version || 1) + 1;
    await existing.save();
    res.json({ success: true, data: existing });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// DELETE /workflows/:id
router.delete("/:id", async (req, res) => {
  try {
    const wf = await Workflow.findByIdAndDelete(req.params.id);
    if (!wf) return res.status(404).json({ success: false, error: "Workflow not found" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /workflows/:id/sandbox — drive the engine against an ephemeral conversation.
// Body: { sessionId?, message, reset?, vars? }
// Returns: { reply, currentNode, diagnostics, sessionId }
router.post("/:id/sandbox", async (req, res) => {
  try {
    const wf = await Workflow.findById(req.params.id);
    if (!wf) return res.status(404).json({ success: false, error: "Workflow not found" });
    if (!wf.nodes || wf.nodes.length === 0) {
      return res.status(400).json({ success: false, error: "Workflow has no nodes to test" });
    }

    const sessionId = req.body.sessionId || `sbx_${req.user.id}_${req.params.id}`;
    let session = sandboxSessions.get(sessionId);
    if (req.body.reset || !session || session.workflowId !== String(wf._id)) {
      session = { workflowId: String(wf._id), state: initState(wf, req.body.vars || {}) };
      sandboxSessions.set(sessionId, session);
    }
    if (req.body.vars) session.state.vars = { ...session.state.vars, ...req.body.vars };

    const { reply, state, diagnostics } = await runWorkflowTurn(
      wf,
      session.state,
      req.body.message || "",
      { sandbox: true }
    );
    session.state = state;

    res.json({
      success: true,
      sessionId,
      reply,
      currentNode: { id: state.nodeId, name: wf.getNode(state.nodeId)?.name },
      diagnostics,
      history: state.history,
    });
  } catch (err) {
    console.error("Sandbox error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
