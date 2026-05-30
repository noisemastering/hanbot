// models/Workflow.js
//
// A "Conversation Workflow" — the router+node graph engine (super_admin only).
// Standalone, top-level entity. NOT governed by campaigns. When a conversation
// is assigned a workflow (assignment wired up separately) and USE_WORKFLOW is on,
// the bot uses the router+node pipeline instead of the legacy flow system.
//
// See FLOW_ARCHITECTURE.md for the legacy flow system this runs ALONGSIDE.
const mongoose = require("mongoose");

// Tool keys a node is allowed to call. Anything outside a node's `toolsAllowed`
// is stripped at parse time (the runtime never exposes it to the model).
const TOOL_KEYS = [
  "share_product_link", // share a tracked ML/product link
  "share_store_link",   // share the generic store link
  "request_handoff",    // hand the conversation to a human
  "capture_lead",       // record name/phone/email
  "ask_location",       // ask for and capture city/zip
  "note",               // attach an internal note (not shown to the customer)
];

const nodeSchema = new mongoose.Schema(
  {
    id: { type: String, required: true }, // stable key, e.g. "probe", "qualify"
    name: { type: String, required: true },
    prompt: { type: String, default: "" }, // replaces the campaign prompt while active

    // 'llm'  → the active node prompts Claude to generate the reply
    // 'auto' → runtime short-circuits the LLM and runs autoAction directly
    kind: { type: String, enum: ["llm", "auto"], default: "llm" },

    isStart: { type: Boolean, default: false }, // where new conversations begin
    terminal: { type: Boolean, default: false }, // skip the router — conversation ends here

    // For kind: 'auto'
    autoAction: {
      type: { type: String, enum: [null, "no_reply", "text", "handoff"], default: null },
      text: { type: String, default: "" },
    },

    toolsAllowed: { type: [String], default: [] }, // subset of TOOL_KEYS
    position: { x: { type: Number, default: 0 }, y: { type: Number, default: 0 } }, // builder canvas
  },
  { _id: false }
);

const edgeSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    from: { type: String, required: true }, // node id
    to: { type: String, required: true },   // node id
    condition: { type: String, default: "" }, // natural-language transition condition
  },
  { _id: false }
);

const workflowSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    description: { type: String, default: "" },
    active: { type: Boolean, default: false },
    version: { type: Number, default: 1 },

    // Always-on system layer: style + JSON format. Node prompts layer on top.
    globalPrompt: { type: String, default: "" },

    startNode: { type: String, default: null }, // node id; falls back to node.isStart
    nodes: { type: [nodeSchema], default: [] },
    edges: { type: [edgeSchema], default: [] },

    // Knowledge tab — reference snippets injected into the model context.
    knowledge: {
      type: [{ title: String, content: String }],
      default: [],
    },

    // Template variables available in prompts as [key] (e.g. [first_name]).
    variables: {
      type: [{ key: String, description: String }],
      default: [],
    },

    // Setup vars that shape behavior. These are DEFAULTS; when a workflow is
    // assigned to an ad, the ad's preloaded product/promo/audience override them
    // per-conversation. Resolved into a CONTEXT block the router + nodes read.
    setup: {
      buyer: { type: String, enum: [null, "", "end_user", "reseller"], default: null },
      purchaseType: { type: String, enum: [null, "", "retail", "wholesale"], default: null },
      saleChannel: { type: String, enum: [null, "", "marketplace", "manual"], default: null },
      productSpecific: {
        kind: { type: String, enum: [null, "", "product", "family"], default: null },
        id: { type: String, default: null },
      },
      // Multi-product override: specific measures or sub-families WITHIN the
      // flow's family. Sellable leaves OR families/subfamilies are allowed here
      // (unlike the flow-level `family`, which must be a non-sellable family).
      products: {
        type: [
          {
            kind: { type: String, enum: [null, "", "product", "family"], default: null },
            id: { type: String, default: null },
            name: { type: String, default: null },
          },
        ],
        default: [],
      },
      hasPromo: { type: mongoose.Schema.Types.Mixed, default: null }, // promo id / items, or null
      tone: { type: String, enum: [null, "", "casual", "professional", "technical"], default: null },
      catalog: {
        kind: { type: String, enum: [null, "", "pdf", "store_link"], default: null },
        value: { type: String, default: null }, // URL to PDF or store
      },
    },

    // Global product realm for the whole workflow: a ProductFamily that is
    // either a root family or a subfamily (a ProductFamily with a parentId).
    // Design-time assignment (set at create/edit), distinct from the
    // per-conversation setup.productSpecific override.
    family: {
      id: { type: mongoose.Schema.Types.ObjectId, ref: "ProductFamily", default: null },
      name: { type: String, default: null }, // cached for display
    },

    // Versions tab — lightweight immutable snapshots taken on save.
    versions: {
      type: [
        {
          version: Number,
          snapshot: mongoose.Schema.Types.Mixed,
          savedAt: { type: Date, default: Date.now },
          savedBy: String,
        },
      ],
      default: [],
    },

    metrics: {
      conversations: { type: Number, default: 0 },
      completions: { type: Number, default: 0 },
    },

    createdBy: { type: String, default: null },
  },
  { timestamps: true }
);

// Resolve the start node id (explicit startNode wins, else first isStart, else first node).
workflowSchema.methods.getStartNodeId = function () {
  if (this.startNode && this.nodes.some((n) => n.id === this.startNode)) return this.startNode;
  const flagged = this.nodes.find((n) => n.isStart);
  if (flagged) return flagged.id;
  return this.nodes[0]?.id || null;
};

workflowSchema.methods.getNode = function (id) {
  return this.nodes.find((n) => n.id === id) || null;
};

workflowSchema.methods.outgoingEdges = function (nodeId) {
  return this.edges.filter((e) => e.from === nodeId);
};

const Workflow = mongoose.model("Workflow", workflowSchema);
Workflow.TOOL_KEYS = TOOL_KEYS;
module.exports = Workflow;
