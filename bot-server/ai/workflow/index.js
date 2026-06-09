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
      const Workflow = require("../../models/Workflow");
      const familyList = Workflow.familyListOf(workflow);
      const { contextBlock, product, priceInfo, catalog } = await resolveSetupContext(
        workflow.setup,
        state.setupOverrides,
        familyList,
        { psid: opts.psid || null, sandbox: !!opts.sandbox }
      );
      state.contextBlock = contextBlock || "";
      state.product = product || null;
      state.priceInfo = priceInfo || null;
      state.catalog = catalog || null; // resolved catalog (climb): {url, kind, source}
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

  const familyList = require("../../models/Workflow").familyListOf(workflow);

  // 1.5 ENGINE-SIDE OUT-OF-FAMILY DETECTION (does not rely on the model calling a
  // tool). If the customer's message points at a product handled by ANOTHER active
  // flow, switch deterministically — product switches need no confirmation.
  if (userMessage && (opts._switchDepth || 0) < 2 && !opts.sandboxNoAutoSwitch) {
    try {
      const det = await detectFlowSwitch(String(userMessage), familyList, workflow);
      if (det && det.toWorkflowId) {
        const handover = await performSwitch(det, {
          history,
          vars,
          lead: state.lead || null,
          location: state.location || null,
          basket: state.basket || [],
          opts,
        });
        if (handover) {
          return {
            reply: handover.reply,
            state: handover.state,
            diagnostics: {
              workflow: { id: String(workflow._id), name: workflow.name },
              autoSwitch: true,
              switchedTo: { id: det.toWorkflowId, name: det.toName },
              detectedProduct: det.product?.name,
              afterSwitch: handover.diagnostics,
            },
          };
        }
      }
    } catch (err) {
      console.error("⚠️ auto flow-switch detection failed:", err.message);
    }
  }

  // 1.6 ENGINE-SIDE IN-FAMILY MEASURE PRICING (does not rely on the model calling
  // share_product_link). If the customer named a measure that exists in THIS
  // flow's families, resolve its price/link now and inject it into this turn's
  // context, so the model quotes it deterministically instead of vague-replying
  // or escalating to a human.
  let turnPriceInfo = state.priceInfo || null;
  let turnContextExtra = "";
  let turnColors = null;
  if (userMessage) {
    try {
      const found = await resolveInFamilyMeasure(String(userMessage), familyList);
      if (found && found.priceInfo) {
        turnPriceInfo = found.priceInfo;
        const pi = found.priceInfo;
        if (pi.handoff) {
          turnContextExtra =
            `\n- COTIZACIÓN SOLICITADA: "${found.name}" no tiene precio disponible. NO inventes precio; ofrece pasar con un asesor.`;
        } else if (pi.amount) {
          // psid-traceable link so a click here is attributed (commerce-status).
          const { trackedLink } = require("./priceResolver");
          const link = await trackedLink(pi.link, {
            psid: opts.psid || null,
            sandbox: !!opts.sandbox,
            productName: found.name,
            productId: found.id,
          });
          turnContextExtra =
            `\n- COTIZACIÓN SOLICITADA AHORA: el cliente pregunta por "${found.name}". Precio $${pi.amount}${pi.source === "ml" ? " (Mercado Libre)" : " (inventario)"}.` +
            (link ? ` Link: ${link}.` : "") +
            ` Cotiza ESTE producto con su precio y link; NO escales a un humano ni pidas la medida de nuevo.`;
        }
        // Available colors/variants for the requested size — so the bot can
        // answer "¿tienes otros colores?" with the real options instead of
        // defaulting to "solo beige" / handoff. Persisted to state below so
        // the answer survives across turns (the color question usually comes
        // a turn AFTER the measure).
        if (found.variants && found.variants.length > 1) {
          // Each color gets its OWN tracked link — never reuse one link for all
          // (that bug shipped the same URL for Beige and Verde).
          const { trackedLink } = require("./priceResolver");
          const options = [];
          for (const v of found.variants) {
            const vlink = v.link
              ? await trackedLink(v.link, {
                  psid: opts.psid || null,
                  sandbox: !!opts.sandbox,
                  productName: `${found.size || ""} ${v.label}`.trim(),
                })
              : null;
            options.push({ label: v.label, link: vlink });
          }
          turnColors = { size: found.size || null, options };
        }
      }
    } catch (err) {
      console.error("⚠️ in-family measure pricing failed:", err.message);
    }
  }

  // If no measure THIS turn but we resolved colors on a previous turn (same
  // active size), keep offering them — the "¿otros colores?" follow-up almost
  // always lands on its own turn.
  if (!turnColors && state.availableColors && state.availableColors.options?.length > 1) {
    turnColors = state.availableColors;
  }
  if (turnColors && turnColors.options?.length > 1) {
    // options may be strings (legacy persisted state) or {label, link}.
    const labelOf = (o) => (typeof o === "string" ? o : o.label);
    const linkOf = (o) => (typeof o === "string" ? null : o.link);
    const lines2 = turnColors.options
      .map((o) => (linkOf(o) ? `${labelOf(o)} → ${linkOf(o)}` : labelOf(o)))
      .join("; ");
    turnContextExtra +=
      `\n- COLORES DISPONIBLES${turnColors.size ? ` para ${turnColors.size}` : ""}: ${lines2}. ` +
      `Comparte el link que corresponde a CADA color — cada uno tiene su PROPIO link, NUNCA reutilices el mismo link para colores distintos. ` +
      `No digas "solo beige" ni escales a un asesor por color.`;
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
    priceInfo: turnPriceInfo, // turn-scoped: the measure the client just asked for
    families: familyList, // realm (for scope checks)
    currentFlowName: workflow.name, // for the AI product-scope classifier
    catalog: state.catalog || null, // resolved catalog for share_catalog tool
    catalogToSend: null, // set by share_catalog → maybeRunAdWorkflow sends the document
    psid: opts.psid || null, // enables psid-traceable links in share_* tools
  };
  const { text, toolCalls } = await executeNode(
    workflow,
    movedTo,
    history,
    vars,
    ctx,
    contextBlock + turnContextExtra
  );

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
    // Remember the active size's color options so a later "¿otros colores?"
    // turn (which carries no measure) can still offer them.
    availableColors: turnColors || state.availableColors || null,
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
    handoffReason: ctx.handoffReason || null,
    catalogToSend: ctx.catalogToSend || null,
  };

  // 6. FLOW SWITCH — a TOOL (model-invoked) decided to hand off to another flow.
  // (The engine-side auto-detect in step 1.5 handles the common case; this covers
  // an explicit switch_flow tool call.)
  if (ctx.switchTo && ctx.switchTo.toWorkflowId && (opts._switchDepth || 0) < 2) {
    const handover = await performSwitch(ctx.switchTo, {
      history,
      vars,
      lead: ctx.lead,
      location: ctx.location,
      basket: newState.basket,
      opts,
      prefixReply: text, // include A's line before B's opening
    });
    if (handover) {
      return {
        reply: handover.reply,
        state: handover.state,
        diagnostics: { ...diagnostics, switchedTo: handover.switchedTo, afterSwitch: handover.diagnostics },
      };
    }
  }

  return { reply: text, state: newState, diagnostics };
}

// Detect whether the customer's message points at a product handled by ANOTHER
// active flow. Reuses check_product_scope's logic via a throwaway ctx; returns
// the switch target { toWorkflowId, toName, product } or null.
async function detectFlowSwitch(message, familyList, currentWorkflow) {
  // Gate: skip very short confirmations ("sí"/"ok"). check_product_scope now
  // uses an AI classifier (one cheap gpt-4o call) to decide product scope —
  // no keyword/regex matching — so attribute words like "beige" no longer
  // trigger false flow-switches.
  if (!message || message.trim().length < 3) return null;
  const { REGISTRY } = require("./tools");
  const probe = {
    actions: [],
    notes: [],
    handoffRequested: false,
    families: familyList,
    currentFlowName: currentWorkflow?.name || null,
    _autoProbe: true,
  };
  try {
    await REGISTRY.check_product_scope.execute({ query: message }, probe);
  } catch {
    return null;
  }
  const sr = probe.scopeResult;
  if (sr && sr.verdict === "other_flow" && sr.toWorkflowId && String(sr.toWorkflowId) !== String(currentWorkflow._id)) {
    return { toWorkflowId: sr.toWorkflowId, toName: sr.toName, product: sr.product };
  }
  return null;
}

// If the customer's message contains a measure (e.g. "4x3") that exists in this
// flow's families, resolve its price/link. Returns { name, priceInfo } or null.
// Only fires for measure-like messages so plain "precio" keeps the preloaded one.
async function resolveInFamilyMeasure(message, familyList) {
  const toolsMod = require("./tools");
  // reuse the dimension parser to gate: no measure → skip (don't override preload)
  if (!toolsMod.dimsOf || !toolsMod.dimsOf(message)) return null;
  const doc = await toolsMod.findProductInFamilies(message, familyList);
  if (!doc) return null;
  const { resolvePrice } = require("./priceResolver");
  // Available color/variant options for this size (structural sibling walk).
  const variants = await toolsMod.availableVariantsForProduct(doc).catch(() => []);
  return { name: doc.name, id: String(doc._id), priceInfo: await resolvePrice(doc), variants };
}

// Carry the conversation over to flow B and run its opening turn. Shared by the
// engine auto-detect (step 1.5) and the explicit switch_flow tool (step 6).
async function performSwitch(switchTo, { history, vars, lead, location, basket, opts, prefixReply }) {
  const target = await loadWorkflowById(switchTo.toWorkflowId);
  if (!target) return null;
  const carried = { comesFromFlowSwitch: true };
  if (switchTo.product && switchTo.product.id) carried.products = [switchTo.product];
  const bState = {
    workflowId: String(target._id),
    nodeId: target.getStartNodeId(),
    history, // carry the whole conversation
    vars,
    setupOverrides: carried,
    lead,
    location,
    basket: basket || [],
    // contextBlock intentionally undefined → re-resolved for flow B
  };
  const bTurn = await runWorkflowTurn(target, bState, "", {
    ...opts,
    _switchDepth: (opts._switchDepth || 0) + 1,
  });
  const reply = [prefixReply, bTurn.reply].filter(Boolean).join("\n\n") || bTurn.reply || prefixReply || null;
  return {
    reply,
    state: bTurn.state,
    switchedTo: { id: String(target._id), name: target.name },
    diagnostics: bTurn.diagnostics,
  };
}

module.exports = { runWorkflowTurn, initState };
