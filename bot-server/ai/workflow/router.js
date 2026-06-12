// ai/workflow/router.js
//
// The router LLM. Given the current node and its outgoing edges (each carrying a
// natural-language condition), it picks the single edge whose condition the
// latest exchange satisfies — or STAY if none do. One transition per turn.
const { getClient, CHAT_MODEL } = require("./llmClient");

const ROUTER_SYSTEM = `You are a deterministic conversation ROUTER for a sales assistant.
Your only job: read the recent conversation and decide which ONE transition out of the current stage now applies.
- You are given the current stage and a list of candidate transitions, each with an id and a condition.
- Pick the id of the transition whose condition is clearly satisfied by the latest exchange.
- If NONE clearly apply, return "STAY" (the conversation remains in the current stage).
- Choose exactly one. Never invent an id. When unsure, prefer "STAY".
Respond ONLY with JSON: {"edge_id": "<id or STAY>", "reason": "<short>"}.`;

function renderTranscript(history, limit = 12) {
  return history
    .slice(-limit)
    .map((m) => `${m.role === "user" ? "Customer" : "Assistant"}: ${m.text}`)
    .join("\n");
}

/**
 * Decide the next node id.
 * @returns {Promise<{nextNodeId: string, edgeId: string|null, reason: string}>}
 */
async function route(workflow, currentNode, history, contextBlock = "") {
  const edges = workflow.outgoingEdges(currentNode.id);

  if (currentNode.terminal || edges.length === 0) {
    return { nextNodeId: currentNode.id, edgeId: null, reason: "terminal_or_no_edges" };
  }

  const enumIds = [...edges.map((e) => e.id), "STAY"];
  const edgeList = edges
    .map((e) => {
      const to = workflow.getNode(e.to);
      return `- id "${e.id}" → stage "${to ? to.name : e.to}": ${e.condition || "(no condition given)"}`;
    })
    .join("\n");

  const userContent = `${contextBlock ? contextBlock + "\n\n" : ""}CURRENT STAGE: "${currentNode.name}"
${currentNode.prompt ? `Stage intent: ${currentNode.prompt.slice(0, 400)}\n` : ""}
CANDIDATE TRANSITIONS:
${edgeList}

RECENT CONVERSATION:
${renderTranscript(history)}

Valid ids: ${enumIds.join(", ")}.
Return the id of the transition that now applies, or "STAY".`;

  const client = getClient();
  let decision = { edge_id: "STAY", reason: "no_output" };
  try {
    const resp = await client.chat.completions.create({
      model: CHAT_MODEL,
      temperature: 0,
      max_tokens: 200,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: ROUTER_SYSTEM },
        { role: "user", content: userContent },
      ],
    });
    const txt = resp.choices?.[0]?.message?.content;
    if (txt) decision = JSON.parse(txt);
  } catch (err) {
    console.error("⚠️ Workflow router error:", err.message);
    // Flag the LLM failure so the engine degrades to a handoff, not silence.
    return { nextNodeId: currentNode.id, edgeId: null, reason: `router_error: ${err.message}`, llmError: true };
  }

  if (!decision.edge_id || decision.edge_id === "STAY" || !enumIds.includes(decision.edge_id)) {
    return { nextNodeId: currentNode.id, edgeId: null, reason: decision.reason || "stay" };
  }
  const edge = edges.find((e) => e.id === decision.edge_id);
  if (!edge || !workflow.getNode(edge.to)) {
    return { nextNodeId: currentNode.id, edgeId: null, reason: "invalid_edge_target" };
  }
  return { nextNodeId: edge.to, edgeId: edge.id, reason: decision.reason || "" };
}

module.exports = { route, renderTranscript };
