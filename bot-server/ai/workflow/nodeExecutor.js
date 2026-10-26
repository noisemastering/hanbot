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

// The model is told to answer in plain text, and almost always does — but it can
// wrap the answer in JSON ({"text":"El precio depende de la medida…"}) or in a
// ```json fence, and nothing downstream unwrapped it, so the CUSTOMER received the
// braces and the key. Seen on the Coldstart flow answering "¿Cuál es el precio de
// la malla?" (reported 2026-10-23, psid 28529106973427095). This is the single
// choke point where the model's text becomes our reply, so it is unwrapped here
// rather than in the verifier or a gate. Only a string that is ENTIRELY one JSON
// object/array is touched, and only when it carries a plain-text field — a reply
// that merely mentions a brace is left alone.
const REPLY_KEYS = ["text", "reply", "message", "respuesta", "mensaje", "content", "output"];

// Length of the balanced JSON object/array that STARTS the string, or 0 if the
// string doesn't open with one that parses. String-aware so a brace or bracket
// inside a quoted value doesn't close the span early.
function leadingJsonSpan(t) {
  const open = t[0];
  if (open !== "{" && open !== "[") return 0;
  const close = open === "{" ? "}" : "]";
  let depth = 0, inStr = false, esc = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        const span = t.slice(0, i + 1);
        try {
          JSON.parse(span);
          return i + 1;
        } catch {
          return 0;
        }
      }
    }
  }
  return 0;
}
function unwrapJsonReply(raw) {
  if (!raw) return raw;
  let t = String(raw).trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) t = fence[1].trim();
  if (!(t.startsWith("{") || t.startsWith("["))) return raw;
  // The model also emits its reasoning as a JSON object and THEN the real reply as
  // prose underneath it ({"text":"Cliente pide precio de mayoreo…"} + "Claro, en
  // mayoreo sí te atiende un asesor…"). Only the prose is for the customer, so a
  // leading, balanced JSON value followed by text is dropped, not unwrapped.
  const head = leadingJsonSpan(t);
  if (head > 0 && head < t.length) {
    const rest = t.slice(head).trim();
    if (rest) {
      console.warn("⚠️ [workflow] model prefixed its reply with JSON; dropped the JSON part");
      return rest;
    }
  }
  let parsed;
  try {
    parsed = JSON.parse(t);
  } catch {
    return raw; // not valid JSON — it's prose that happens to start with a brace
  }
  const pick = (o) => {
    if (typeof o === "string") return o;
    if (!o || typeof o !== "object") return null;
    for (const k of REPLY_KEYS) {
      const v = Array.isArray(o) ? null : o[k];
      if (typeof v === "string" && v.trim()) return v;
    }
    return null;
  };
  const out = Array.isArray(parsed) ? parsed.map(pick).filter(Boolean).join("\n") : pick(parsed);
  if (!out || !out.trim()) return raw; // nothing readable inside → leave it for the verifier
  console.warn("⚠️ [workflow] model replied in JSON; unwrapped the text field");
  return out.trim();
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
        temperature: 0.1, // near-deterministic: keeps sandbox ≈ live (was 0.5, which let
        // the SAME model give different answers per call — e.g. 7x7 quoted vs denied)
        max_completion_tokens: 600, // GPT-5.x require this; gpt-4o accepts it too
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
    if (msg.content) finalText = unwrapJsonReply(msg.content.trim());

    if (!msg.tool_calls || msg.tool_calls.length === 0) break;

    messages.push(msg); // assistant turn carrying the tool_calls
    for (const tc of msg.tool_calls) {
      let args = {};
      try {
        args = JSON.parse(tc.function.arguments || "{}");
      } catch {
        /* ignore malformed args */
      }
      const out = await runTool(tc.function.name, args, ctx);
      // Capture the tool OUTPUT too — the grounding verifier needs to see facts
      // that came from tools (e.g. share_product_link's "Precio: $599"), not
      // just the pre-injected context.
      toolCalls.push({ name: tc.function.name, input: args, output: String(out) });
      messages.push({ role: "tool", tool_call_id: tc.id, content: String(out) });
    }
  }

  return { text: finalText || null, toolCalls };
}

module.exports = { executeNode, applyVars, unwrapJsonReply };
