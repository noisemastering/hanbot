// routes/workflowsRoutes.js
//
// Conversation Workflow API — SUPER_ADMIN ONLY.
// CRUD + JSON import + a chat-style sandbox that drives the router+node engine
// against an ephemeral in-memory conversation (never a real Meta user).
const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const Workflow = require("../models/Workflow");
const Ad = require("../models/Ad");
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

// ===== Ad → workflow assignment (attach a flow to an ad + set vars + toggle) =====
// Registered BEFORE the generic "/:id" routes so GET /ads is not swallowed by /:id.

// GET /workflows/ads?q= — search ads for the assignment picker (name or fbAdId).
// Ordered newest-ad-first. NOTE: createdAt/updatedAt are SYNC timestamps (most
// ads land in one bulk sync, so they cluster and don't reflect real ad age).
// Facebook ad IDs increase monotonically with creation, so fbAdId desc is the
// reliable "newest ad first" ordering. Limit is generous so the default browse
// list isn't truncated; search narrows by name/id.
router.get("/ads", async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    const filter = {};
    if (q) {
      filter.$or = [
        { name: { $regex: q, $options: "i" } },
        { fbAdId: { $regex: q, $options: "i" } },
      ];
    }
    const total = await Ad.countDocuments(filter);
    const ads = await Ad.find(filter)
      .select("name fbAdId status workflowId workflowEnabled workflowSetup")
      .sort({ fbAdId: -1 })
      .limit(300)
      .populate("workflowId", "name active")
      .lean();
    res.json({ success: true, data: ads, total });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /workflows/ads/:adId — attach/detach a workflow, set its vars, toggle on/off.
// Body: { workflowId?, workflowSetup?, workflowEnabled? }
router.patch("/ads/:adId", async (req, res) => {
  try {
    const ad = await Ad.findById(req.params.adId);
    if (!ad) return res.status(404).json({ success: false, error: "Ad not found" });

    const b = req.body || {};
    if ("workflowId" in b) ad.workflowId = b.workflowId || null;
    if ("workflowSetup" in b) ad.workflowSetup = b.workflowSetup || null;
    if ("workflowEnabled" in b) ad.workflowEnabled = !!b.workflowEnabled;

    // Can't turn the takeover on without a workflow attached.
    if (ad.workflowEnabled && !ad.workflowId) {
      return res
        .status(400)
        .json({ success: false, error: "Asigna un workflow antes de activarlo." });
    }

    await ad.save();
    const out = await Ad.findById(ad._id)
      .select("name fbAdId status workflowId workflowEnabled workflowSetup")
      .populate("workflowId", "name active")
      .lean();
    res.json({ success: true, data: out });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

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

// POST /workflows/:id/duplicate — copy an existing flow into a new INACTIVE one.
// Carries nodes/edges/setup/family/globalPrompt/knowledge; drops versions/metrics.
router.post("/:id/duplicate", async (req, res) => {
  try {
    const src = await Workflow.findById(req.params.id).lean();
    if (!src) return res.status(404).json({ success: false, error: "Workflow not found" });

    const { _id, version, versions, metrics, createdAt, updatedAt, createdBy, ...rest } = src;

    const copy = new Workflow({
      ...rest,
      name: req.body.name || `${src.name} (copia)`,
      active: false, // duplicates always start inactive
      version: 1,
      versions: [],
      metrics: { conversations: 0, completions: 0 },
      createdBy: req.user.username || req.user.email,
    });
    await copy.save();
    res.status(201).json({ success: true, data: copy });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ===== Node templates (reusable node library) =====
const WorkflowNodeTemplate = require("../models/WorkflowNodeTemplate");

// GET /workflows/node-templates/all — list saved node templates
router.get("/node-templates/all", async (req, res) => {
  try {
    const list = await WorkflowNodeTemplate.find().sort({ updatedAt: -1 });
    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /workflows/node-templates — save a node as a template
router.post("/node-templates", async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ success: false, error: "Template requires a name" });
    const tpl = await WorkflowNodeTemplate.create({
      name: b.name,
      description: b.description || "",
      prompt: b.prompt || "",
      kind: b.kind === "auto" ? "auto" : "llm",
      terminal: !!b.terminal,
      autoAction: b.autoAction || { type: null, text: "" },
      toolsAllowed: Array.isArray(b.toolsAllowed) ? b.toolsAllowed : [],
      createdBy: req.user.username || req.user.email,
    });
    res.status(201).json({ success: true, data: tpl });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// DELETE /workflows/node-templates/:tid — remove a template
router.delete("/node-templates/:tid", async (req, res) => {
  try {
    const t = await WorkflowNodeTemplate.findByIdAndDelete(req.params.tid);
    if (!t) return res.status(404).json({ success: false, error: "Template not found" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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
    // Keep only the last 20 snapshots so the doc never approaches the 16MB BSON limit.
    if (existing.versions.length > 20) existing.versions = existing.versions.slice(-20);

    const { versions, _id, createdAt, ...patch } = req.body;
    sanitizeWorkflowPatch(patch);

    // Mandatory: every workflow must have at least one family/subfamily. No rogue
    // flows. Accept the new families[] or the legacy single family, from the patch
    // when edited, else from the existing doc.
    const famsFromPatch = Array.isArray(patch.families)
      ? patch.families.filter((f) => f && f.id)
      : null;
    const singleFromPatch = patch.family && "id" in patch.family ? patch.family.id : undefined;
    const hasFamily =
      (famsFromPatch && famsFromPatch.length > 0) ||
      (famsFromPatch === null && (existing.families || []).some((f) => f && f.id)) ||
      (singleFromPatch ? true : singleFromPatch === undefined ? !!existing.family?.id : false);
    if (!hasFamily) {
      return res.status(400).json({
        success: false,
        error: "Un workflow debe tener al menos una familia o subfamilia de producto asignada (pestaña Config).",
      });
    }

    Object.assign(existing, patch);
    existing.version = (existing.version || 1) + 1;
    await existing.save();

    // Single-winner: only ONE workflow may be the cold-start handler. If this
    // save turned the flag ON, clear it on every other workflow.
    if (existing.isColdStart) {
      await Workflow.updateMany(
        { _id: { $ne: existing._id }, isColdStart: true },
        { $set: { isColdStart: false } }
      );
    }

    res.json({ success: true, data: existing });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// PATCH /workflows/:id/prompts — lightweight live edits from the simulator.
// Updates the global prompt and/or a single node's prompt WITHOUT snapshotting a
// version (the full studio Save still versions). The sandbox re-reads the
// workflow each turn, so changes apply to the next message.
router.patch("/:id/prompts", async (req, res) => {
  try {
    const wf = await Workflow.findById(req.params.id);
    if (!wf) return res.status(404).json({ success: false, error: "Workflow not found" });

    if (typeof req.body.globalPrompt === "string") wf.globalPrompt = req.body.globalPrompt;

    if (req.body.node && req.body.node.id) {
      const node = wf.nodes.find((n) => n.id === req.body.node.id);
      if (!node) return res.status(404).json({ success: false, error: "Node not found" });
      if (typeof req.body.node.prompt === "string") node.prompt = req.body.node.prompt;
    }

    await wf.save();
    res.json({ success: true, data: wf });
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
      session = {
        workflowId: String(wf._id),
        state: initState(wf, req.body.vars || {}, req.body.setup || {}),
      };
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

// Coerce empty-string ObjectId fields to null so Mongoose validators don't 500
// when the dashboard echoes back an unset family / product reference.
function sanitizeWorkflowPatch(patch) {
  if (!patch || typeof patch !== "object") return;
  if (patch.family && (patch.family.id === "" || patch.family.id === undefined)) {
    patch.family.id = null;
  }
  // families[]: drop entries with empty/invalid ids.
  if (Array.isArray(patch.families)) {
    patch.families = patch.families.filter((f) => f && f.id && f.id !== "");
  }
  if (patch.setup && patch.setup.productSpecific) {
    const ps = patch.setup.productSpecific;
    if (ps.id === "") ps.id = null;
    if (ps.kind === "") ps.kind = null;
  }
  // Drop meta fields that must never be $set via save()
  delete patch.__v;
  delete patch.updatedAt;
}

module.exports = router;
