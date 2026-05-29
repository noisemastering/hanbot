// ai/workflow/router.js
//
// The router LLM. Given the current node and its outgoing edges (each carrying a
// natural-language condition), it picks the single edge whose condition the
// latest exchange satisfies — or STAY if none do. One transition per turn.
const { getClient, buildSystem, ROUTER_MODEL } = require("./claudeClient");

const ROUTER_SYSTEM = `You are a deterministic conversation ROUTER for a sales assistant.
Your only job: read the recent conversation and decide which ONE transition out of the current stage now applies.
- You are given the current stage and a list of candidate transitions, each with an id and a condition.
- Pick the id of the transition whose condition is clearly satisfied by the latest exchange.
- If NONE clearly apply, return "STAY" (the conversation remains in the current stage).
- Choose exactly one. Never invent an id. When unsure, prefer "STAY".`;

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
async function route(workflow, currentNode, history) {
  const edges = workflow.outgoingEdges(currentNode.id);

  // Terminal node or no edges → nothing to route.
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

  const userContent = `CURRENT STAGE: "${currentNode.name}"
${currentNode.prompt ? `Stage intent: ${currentNode.prompt.slice(0, 400)}\n` : ""}
CANDIDATE TRANSITIONS:
${edgeList}

RECENT CONVERSATION:
${renderTranscript(history)}

Return the id of the transition that now applies, or "STAY".`;

  const client = getClient();
  let resp;
  try {
    resp = await client.messages.create({
      model: ROUTER_MODEL,
      max_tokens: 256,
      output_config: {
        effort: "low",
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              edge_id: { type: "string", enum: enumIds },
              reason: { type: "string" },
            },
            required: ["edge_id"],
            additionalProperties: false,
          },
        },
      },
      system: buildSystem(ROUTER_SYSTEM),
      messages: [{ role: "user", content: userContent }],
    });
  } catch (err) {
    console.error("⚠️ Workflow router error:", err.message);
    return { nextNodeId: currentNode.id, edgeId: null, reason: `router_error: ${err.message}` };
  }

  const textBlock = resp.content.find((b) => b.type === "text");
  let decision = { edge_id: "STAY", reason: "no_output" };
  if (textBlock) {
    try {
      decision = JSON.parse(textBlock.text);
    } catch {
      /* fall through to STAY */
    }
  }

  if (!decision.edge_id || decision.edge_id === "STAY") {
    return { nextNodeId: currentNode.id, edgeId: null, reason: decision.reason || "stay" };
  }
  const edge = edges.find((e) => e.id === decision.edge_id);
  if (!edge || !workflow.getNode(edge.to)) {
    return { nextNodeId: currentNode.id, edgeId: null, reason: "invalid_edge_target" };
  }
  return { nextNodeId: edge.to, edgeId: edge.id, reason: decision.reason || "" };
}

module.exports = { route, renderTranscript };
