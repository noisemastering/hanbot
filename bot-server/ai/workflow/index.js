// ai/workflow/index.js
//
// Orchestrator for the router+node "Conversation Workflow" engine.
//
// runWorkflowTurn() is engine-pure: it takes the workflow, a plain STATE object,
// and the incoming user message, and returns { reply, state, diagnostics }.
// The caller owns persistence — real conversations map convo fields to/from
// `state`; the sandbox keeps `state` in an ephemeral store. This keeps the engine
// decoupled from the Conversation model.
//
// Per turn:
//   1. append the user message to history
//   2. router picks the next node (or stays)
//   3. if the new node is 'auto', run its action; else execute the node prompt
//   4. run any tool calls (gated by the node's allowlist, handled in the executor)
//   5. append the assistant reply, return updated state + diagnostics
const { route } = require("./router");
const { executeNode } = require("./nodeExecutor");

// Build a fresh state object for a brand-new conversation on this workflow.
function initState(workflow, vars = {}) {
  return {
    workflowId: workflow._id ? String(workflow._id) : null,
    nodeId: workflow.getStartNodeId(),
    history: [], // [{ role: 'user'|'assistant', text, nodeId, at }]
    vars,
  };
}

/**
 * Advance the conversation one turn.
 * @param {Workflow} workflow - a hydrated Workflow mongoose doc (has methods)
 * @param {object} state - { nodeId, history, vars }
 * @param {string} userMessage
 * @param {object} [opts] - { sandbox: bool }
 * @returns {Promise<{reply: string|null, state: object, diagnostics: object}>}
 */
async function runWorkflowTurn(workflow, state, userMessage, opts = {}) {
  const vars = state.vars || {};
  const history = Array.isArray(state.history) ? [...state.history] : [];

  // Resolve current node (heal if missing/stale).
  let currentNode = workflow.getNode(state.nodeId) || workflow.getNode(workflow.getStartNodeId());
  if (!currentNode) {
    return {
      reply: null,
      state,
      diagnostics: { error: "workflow has no nodes" },
    };
  }

  // 1. record the incoming message
  if (userMessage != null && userMessage !== "") {
    history.push({ role: "user", text: String(userMessage), nodeId: currentNode.id, at: new Date() });
  }

  // 2. route
  const decision = await route(workflow, currentNode, history);
  const movedTo = workflow.getNode(decision.nextNodeId) || currentNode;

  // 3 + 4. execute the (possibly new) active node
  const ctx = {
    sandbox: !!opts.sandbox,
    actions: [],
    notes: [],
    handoffRequested: false,
    lead: state.lead || null,
    location: state.location || null,
  };
  const { text, toolCalls } = await executeNode(workflow, movedTo, history, vars, ctx);

  // 5. record the reply
  if (text) {
    history.push({ role: "assistant", text, nodeId: movedTo.id, at: new Date() });
  }

  const newState = {
    ...state,
    nodeId: movedTo.id,
    history,
    vars,
    lead: ctx.lead,
    location: ctx.location,
  };

  const diagnostics = {
    fromNode: { id: currentNode.id, name: currentNode.name },
    toNode: { id: movedTo.id, name: movedTo.name },
    edgeId: decision.edgeId,
    routerReason: decision.reason,
    terminal: !!movedTo.terminal,
    toolCalls,
    actions: ctx.actions,
    handoffRequested: ctx.handoffRequested,
  };

  return { reply: text, state: newState, diagnostics };
}

module.exports = { runWorkflowTurn, initState };
