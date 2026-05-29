// ai/workflow/claudeClient.js
//
// Thin wrapper around the Anthropic SDK for the router+node workflow engine.
// Centralizes the client, model selection, and prompt-caching helpers so the
// router and node executor stay simple.
const AnthropicLib = require("@anthropic-ai/sdk");
const Anthropic = AnthropicLib.default || AnthropicLib;

// Model tiers. Default everything to Opus 4.8; the router can be pointed at a
// cheaper tier later via WORKFLOW_ROUTER_MODEL if cost/latency demands it.
const NODE_MODEL = process.env.WORKFLOW_NODE_MODEL || "claude-opus-4-8";
const ROUTER_MODEL = process.env.WORKFLOW_ROUTER_MODEL || "claude-opus-4-8";

let _client = null;
function getClient() {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set — the workflow engine requires it. Add it to the environment."
    );
  }
  _client = new Anthropic({ apiKey });
  return _client;
}

// Build a cacheable system array: the stable prefix (global prompt + knowledge)
// carries a cache_control breakpoint so repeated turns reuse it.
function buildSystem(stableText, volatileText) {
  const system = [];
  if (stableText && stableText.trim()) {
    system.push({ type: "text", text: stableText, cache_control: { type: "ephemeral" } });
  }
  if (volatileText && volatileText.trim()) {
    system.push({ type: "text", text: volatileText });
  }
  return system.length ? system : undefined;
}

module.exports = { getClient, buildSystem, NODE_MODEL, ROUTER_MODEL };
