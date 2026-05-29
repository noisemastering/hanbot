// ai/workflow/nodeExecutor.js
//
// Runs the ACTIVE node to produce the assistant's reply. The global prompt
// (style + format) is the stable, cached system layer; the node prompt layers
// on top as the turn-specific behavior. Only the node's allowed tools are
// exposed; the runtime executes any tool calls and loops until the model
// produces its final text.
const { getClient, buildSystem, NODE_MODEL } = require("./claudeClient");
const { toolDefsFor, runTool } = require("./tools");

// Replace [key] placeholders (e.g. [first_name]) from the vars bag.
function applyVars(text, vars = {}) {
  if (!text) return text;
  return text.replace(/\[([a-z0-9_]+)\]/gi, (m, k) => {
    const v = vars[k] ?? vars[k.toLowerCase()];
    return v == null || v === "" ? m : String(v);
  });
}

function buildStableSystem(workflow, vars) {
  let stable = applyVars(workflow.globalPrompt || "", vars);
  if (workflow.knowledge && workflow.knowledge.length) {
    const kb = workflow.knowledge
      .filter((k) => k && (k.title || k.content))
      .map((k) => `### ${k.title || "Nota"}\n${k.content || ""}`)
      .join("\n\n");
    if (kb) stable += `\n\n## KNOWLEDGE BASE\n${kb}`;
  }
  return stable.trim();
}

/**
 * Generate the reply for the active node.
 * @returns {Promise<{text: string, toolCalls: Array}>}
 */
async function executeNode(workflow, node, history, vars, ctx) {
  // Auto nodes short-circuit the LLM entirely.
  if (node.kind === "auto") {
    const action = node.autoAction || {};
    if (action.type === "no_reply") return { text: null, toolCalls: [] };
    if (action.type === "handoff") {
      await runTool("request_handoff", { reason: "auto node" }, ctx);
      return { text: applyVars(action.text || "", vars) || null, toolCalls: [{ name: "request_handoff" }] };
    }
    return { text: applyVars(action.text || "", vars), toolCalls: [] };
  }

  const stableSystem = buildStableSystem(workflow, vars);
  const nodeInstruction = `## CURRENT STAGE: ${node.name}\n${applyVars(node.prompt || "", vars)}`;
  const tools = toolDefsFor(node.toolsAllowed || []);

  const messages = history.map((m) => ({
    role: m.role === "user" ? "user" : "assistant",
    content: m.text,
  }));
  // Conversations must start with a user turn.
  if (!messages.length || messages[0].role !== "user") {
    messages.unshift({ role: "user", content: "(inicio de conversación)" });
  }

  const client = getClient();
  const toolCalls = [];
  let finalText = "";

  for (let i = 0; i < 4; i++) {
    let resp;
    try {
      resp = await client.messages.create({
        model: NODE_MODEL,
        max_tokens: 1024,
        output_config: { effort: "medium" },
        system: buildSystem(stableSystem, nodeInstruction),
        ...(tools.length ? { tools } : {}),
        messages,
      });
    } catch (err) {
      console.error("⚠️ Workflow nodeExecutor error:", err.message);
      return { text: finalText || null, toolCalls };
    }

    const textParts = resp.content.filter((b) => b.type === "text").map((b) => b.text);
    if (textParts.length) finalText = textParts.join("\n").trim();

    if (resp.stop_reason !== "tool_use") break;

    const toolUses = resp.content.filter((b) => b.type === "tool_use");
    messages.push({ role: "assistant", content: resp.content });

    const results = [];
    for (const tu of toolUses) {
      toolCalls.push({ name: tu.name, input: tu.input });
      const out = await runTool(tu.name, tu.input, ctx);
      results.push({ type: "tool_result", tool_use_id: tu.id, content: String(out) });
    }
    messages.push({ role: "user", content: results });
  }

  return { text: finalText || null, toolCalls };
}

module.exports = { executeNode, applyVars };
