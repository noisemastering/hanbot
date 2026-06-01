// models/WorkflowNodeTemplate.js
//
// A reusable node snippet for the Conversation Workflow builder. Stores the
// flow-independent parts of a node (name, prompt, kind, tools, autoAction).
// Position and edges are flow-specific, so they are NOT stored here — a fresh
// id + position are assigned when a template is inserted into a flow.
const mongoose = require("mongoose");

const workflowNodeTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String, default: "" }, // librarian note, not used at runtime
    prompt: { type: String, default: "" },
    kind: { type: String, enum: ["llm", "auto"], default: "llm" },
    terminal: { type: Boolean, default: false },
    autoAction: {
      type: { type: String, enum: [null, "no_reply", "text", "handoff"], default: null },
      text: { type: String, default: "" },
    },
    toolsAllowed: { type: [String], default: [] },
    createdBy: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("WorkflowNodeTemplate", workflowNodeTemplateSchema);
