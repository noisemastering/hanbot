// ai/workflow/nodeExecutor.js
//
// Runs the ACTIVE node to produce the assistant's reply (OpenAI chat
// completions). The global prompt (style + format) + resolved setup CONTEXT form
// the system layer; the node prompt layers on top as turn-specific behavior.
// Only the node's allowed tools are exposed; tool calls are executed and looped
// until the model produces its final text.
const { getClient, CHAT_MODEL } = require("./llmClient");
const { toolDefsFor, runTool } = require("./tools");

// Replace [key] placeholders (e.g. [first_name]) from the vars bag.
function applyVars(text, vars = {}) {
  if (!text) return text;
  return text.replace(/\[([a-z0-9_]+)\]/gi, (m, k) => {
    const v = vars[k] ?? vars[k.toLowerCase()];
    return v == null || v === "" ? m : String(v);
  });
}

function buildSystem(workflow, node, vars, contextBlock) {
  let sys = applyVars(workflow.globalPrompt || "", vars);
  if (workflow.knowledge && workflow.knowledge.length) {
    const kb = workflow.knowledge
      .filter((k) => k && (k.title || k.content))
      .map((k) => `### ${k.title || "Nota"}\n${k.content || ""}`)
      .join("\n\n");
    if (kb) sys += `\n\n## KNOWLEDGE BASE\n${kb}`;
  }
  if (contextBlock) sys += `\n\n## CONTEXT (setup de esta conversación)\n${contextBlock}`;
  sys += `\n\n## CURRENT STAGE: ${node.name}\n${applyVars(node.prompt || "", vars)}`;
  return sys.trim();
}

// Map our (Anthropic-style) tool registry definitions to OpenAI function tools.
function toOpenAITools(allowed) {
  return toolDefsFor(allowed).map((d) => ({
    type: "function",
    function: { name: d.name, description: d.description, parameters: d.input_schema },
  }));
}

/**
 * Generate the reply for the active node.
 * @returns {Promise<{text: string|null, toolCalls: Array}>}
 */
async function executeNode(workflow, node, history, vars, ctx, contextBlock = "") {
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

  const system = buildSystem(workflow, node, vars, contextBlock);
  const tools = toOpenAITools(node.toolsAllowed || []);

  const messages = [{ role: "system", content: system }];
  for (const m of history) {
    messages.push({ role: m.role === "user" ? "user" : "assistant", content: m.text });
  }
  if (history.length === 0) messages.push({ role: "user", content: "(inicio de conversación)" });

  const client = getClient();
  const toolCalls = [];
  let finalText = "";

  for (let i = 0; i < 4; i++) {
    let resp;
    try {
      resp = await client.chat.completions.create({
        model: CHAT_MODEL,
        temperature: 0.5,
        max_tokens: 600,
        messages,
        ...(tools.length ? { tools, tool_choice: "auto" } : {}),
      });
    } catch (err) {
      console.error("⚠️ Workflow nodeExecutor error:", err.message);
      // Signal an LLM failure so the engine can degrade to a human handoff
      // instead of returning a silent null (which ghosts the customer).
      return { text: finalText || null, toolCalls, llmError: true };
    }

    const msg = resp.choices?.[0]?.message;
    if (!msg) break;
    if (msg.content) finalText = msg.content.trim();

    if (!msg.tool_calls || msg.tool_calls.length === 0) break;

    messages.push(msg); // assistant turn carrying the tool_calls
    for (const tc of msg.tool_calls) {
      let args = {};
      try {
        args = JSON.parse(tc.function.arguments || "{}");
      } catch {
        /* ignore malformed args */
      }
      toolCalls.push({ name: tc.function.name, input: args });
      const out = await runTool(tc.function.name, args, ctx);
      messages.push({ role: "tool", tool_call_id: tc.id, content: String(out) });
    }
  }

  return { text: finalText || null, toolCalls };
}

module.exports = { executeNode, applyVars };
