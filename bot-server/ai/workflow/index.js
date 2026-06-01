// ai/workflow/index.js
//
// Orchestrator for the router+node "Conversation Workflow" engine.
//
// runWorkflowTurn() takes the workflow, a plain STATE object, and the incoming
// user message, and returns { reply, state, diagnostics }. The caller owns
// persistence — real conversations map convo fields to/from `state`; the sandbox
// keeps `state` in an ephemeral store.
//
// Per turn:
//   0. self-correct: if state points to a switched-to flow, run THAT flow
//   1. append the user message to history
//   2. router picks the next node (or stays)
//   3. if the new node is 'auto', run its action; else execute the node prompt
//   4. run any tool calls (gated by the node's allowlist)
//   5. append the assistant reply
//   6. FLOW SWITCH: if a tool requested handing to another flow, load it, carry
//      over the conversation + basket + client data, and run its opening turn.
const { route } = require("./router");
const { executeNode } = require("./nodeExecutor");
const { resolveSetupContext } = require("./setupContext");

// Lazy-load the model to avoid require cycles at module init.
async function loadWorkflowById(id) {
  if (!id) return null;
  try {
    return await require("../../models/Workflow").findById(id);
  } catch {
    return null;
  }
}

// Build a fresh state object for a brand-new conversation on this workflow.
function initState(workflow, vars = {}, setupOverrides = {}) {
  return {
    workflowId: workflow._id ? String(workflow._id) : null,
    nodeId: workflow.getStartNodeId(),
    history: [], // [{ role: 'user'|'assistant', text, nodeId, at }]
    vars,
    setupOverrides, // per-conversation overrides (ad assignment / sandbox / flow switch)
    basket: [], // carried-over product basket across flow switches
  };
}

/**
 * Advance the conversation one turn.
 * @param {Workflow} workflow - a hydrated Workflow doc (may be overridden by state.workflowId)
 * @param {object} state
 * @param {string} userMessage
 * @param {object} [opts] - { sandbox: bool, _switchDepth?: number }
 * @returns {Promise<{reply: string|null, state: object, diagnostics: object}>}
 */
async function runWorkflowTurn(workflow, state, userMessage, opts = {}) {
  // 0. Self-correct: a prior turn may have switched the active flow. Always run
  // the flow the STATE points to, regardless of what the caller passed in.
  if (state.workflowId && workflow && String(workflow._id) !== state.workflowId) {
    const active = await loadWorkflowById(state.workflowId);
    if (active) workflow = active;
  }

  const vars = state.vars || {};
  const history = Array.isArray(state.history) ? [...state.history] : [];

  // Resolve the setup CONTEXT once per (flow within a) conversation.
  if (state.contextBlock === undefined) {
    try {
      const { contextBlock, product, priceInfo } = await resolveSetupContext(
        workflow.setup,
        state.setupOverrides,
        workflow.family
      );
      state.contextBlock = contextBlock || "";
      state.product = product || null;
      state.priceInfo = priceInfo || null;
    } catch (err) {
      console.error("⚠️ setup context resolution failed:", err.message);
      state.contextBlock = "";
    }
  }
  const contextBlock = state.contextBlock || "";

  // Resolve current node (heal if missing/stale — e.g. just switched flows).
  let currentNode = workflow.getNode(state.nodeId) || workflow.getNode(workflow.getStartNodeId());
  if (!currentNode) {
    return { reply: null, state, diagnostics: { error: "workflow has no nodes" } };
  }

  // 1. record the incoming message
  if (userMessage != null && userMessage !== "") {
    history.push({ role: "user", text: String(userMessage), nodeId: currentNode.id, at: new Date() });
  }

  // 2. route
  const decision = await route(workflow, currentNode, history, contextBlock);
  const movedTo = workflow.getNode(decision.nextNodeId) || currentNode;

  // 3 + 4. execute the (possibly new) active node
  const ctx = {
    sandbox: !!opts.sandbox,
    actions: [],
    notes: [],
    handoffRequested: false,
    switchTo: null, // a tool may set { toWorkflowId, toName, product } to switch flows
    lead: state.lead || null,
    location: state.location || null,
    product: state.product || null,
    priceInfo: state.priceInfo || null,
    family: workflow.family || null, // this flow's product realm (for scope checks)
  };
  const { text, toolCalls } = await executeNode(workflow, movedTo, history, vars, ctx, contextBlock);

  // 5. record the reply
  if (text) {
    history.push({ role: "assistant", text, nodeId: movedTo.id, at: new Date() });
  }

  const newState = {
    ...state,
    workflowId: String(workflow._id),
    nodeId: movedTo.id,
    history,
    vars,
    lead: ctx.lead,
    location: ctx.location,
    basket: state.basket || [],
  };

  const diagnostics = {
    workflow: { id: String(workflow._id), name: workflow.name },
    fromNode: { id: currentNode.id, name: currentNode.name },
    toNode: { id: movedTo.id, name: movedTo.name },
    edgeId: decision.edgeId,
    routerReason: decision.reason,
    terminal: !!movedTo.terminal,
    toolCalls,
    actions: ctx.actions,
    handoffRequested: ctx.handoffRequested,
  };

  // 6. FLOW SWITCH — a tool decided to hand the conversation to another flow.
  // Load flow B, carry over the conversation + basket + client data + the product
  // the client asked for, mark comesFromFlowSwitch (no greeting), and run B's
  // opening turn now so the customer gets a seamless continuation.
  if (ctx.switchTo && ctx.switchTo.toWorkflowId && (opts._switchDepth || 0) < 2) {
    const target = await loadWorkflowById(ctx.switchTo.toWorkflowId);
    if (target) {
      const carried = { comesFromFlowSwitch: true };
      if (ctx.switchTo.product && ctx.switchTo.product.id) {
        carried.products = [ctx.switchTo.product];
      }
      const bState = {
        workflowId: String(target._id),
        nodeId: target.getStartNodeId(),
        history, // carry the whole conversation
        vars,
        setupOverrides: carried,
        lead: ctx.lead,
        location: ctx.location,
        basket: newState.basket,
        // contextBlock intentionally undefined → re-resolved for flow B
      };
      const bTurn = await runWorkflowTurn(target, bState, "", {
        ...opts,
        _switchDepth: (opts._switchDepth || 0) + 1,
      });
      // A's confirmation line (if any) + B's opening, so the switch reads naturally.
      const combined = [text, bTurn.reply].filter(Boolean).join("\n\n");
      return {
        reply: combined || bTurn.reply || text || null,
        state: bTurn.state,
        diagnostics: {
          ...diagnostics,
          switchedTo: { id: String(target._id), name: target.name },
          afterSwitch: bTurn.diagnostics,
        },
      };
    }
  }

  return { reply: text, state: newState, diagnostics };
}

module.exports = { runWorkflowTurn, initState };
