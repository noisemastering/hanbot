// utils/openaiUsagePatch.js
//
// One patch, applied once, that makes EVERY OpenAI chat call report its tokens — the
// in-memory budget tracker (`aiUsageTracker`) and the persistent per-call record behind
// the "Costos IA" view (`aiUsageLogger` → the AiUsage collection).
//
// WHY IT EXISTS: the previous patch did
//
//     require('openai').OpenAI = class extends OrigOpenAI { … }
//
// and **silently did nothing**. On openai v6 the package's `OpenAI` export is a GETTER
// with no setter (`{ get: true, set: false, configurable: true }`), so in non-strict CJS
// that assignment is discarded without an error: every module that later wrote
// `const { OpenAI } = require("openai")` got the untouched class. Found 2026-10-27 — the
// `aiusages` collection had **0 documents** after months of traffic, which is why nobody
// could answer "how much have we spent" from our own dashboard and the number had to be
// read off platform.openai.com by hand. Writes to the collection were never the problem;
// the recorder was never called.
//
// WHAT IT PATCHES INSTEAD: `Completions.prototype.create`, reached from a throwaway
// client (constructing one performs no network call). That method is `writable` and
// `configurable`, and it is shared by every client instance — so this covers clients
// built before or after this runs, clients built from the default export or the named
// one, and `utils/trackedOpenAI.js`'s own per-instance wrapper, which calls through to
// it. Import order stops mattering, which is the whole point: the old patch's silent
// failure mode was that it depended on it.
//
// It records ONLY `chat.completions`. Nothing in this codebase uses the Responses API;
// if something starts to, it needs its own line here (and `grep responses.create` is the
// check). Telemetry is fire-and-forget throughout: a failure here must never cost a reply.

let installed = false;

/**
 * Patch the OpenAI SDK so every chat completion reports its usage. Idempotent.
 * @returns {boolean} true if the patch was applied by this call
 */
function installOpenAiUsagePatch() {
  if (installed) return false;
  try {
    const { recordCall, recordError } = require("./aiUsageTracker");
    const { recordUsage } = require("../ai/utils/aiUsageLogger");
    const { OpenAI } = require("openai");

    // A client is needed only to reach the resource class; no request is made.
    const probe = new OpenAI({ apiKey: "sk-not-used-for-requests" });
    const proto = Object.getPrototypeOf(probe.chat.completions);
    if (!proto || typeof proto.create !== "function") {
      console.error("⚠️ OpenAI usage patch: completions.create not found — usage will NOT be tracked");
      return false;
    }
    if (proto.__usagePatched) { installed = true; return false; }

    const origCreate = proto.create;
    proto.create = async function (...args) {
      try {
        const result = await origCreate.apply(this, args);
        try {
          if (result && result.usage) {
            const model = result.model || args[0]?.model || "unknown";
            recordCall(model, result.usage.prompt_tokens, result.usage.completion_tokens);
            recordUsage(model, result.usage);
          }
        } catch (e) {
          // Telemetry must never turn a good reply into an error.
          console.error("⚠️ usage telemetry failed:", e.message);
        }
        return result;
      } catch (err) {
        try { recordError(err); } catch { /* ignore */ }
        throw err;
      }
    };
    proto.__usagePatched = true;
    installed = true;
    return true;
  } catch (e) {
    console.error("⚠️ could not install the OpenAI usage patch:", e.message);
    return false;
  }
}

module.exports = { installOpenAiUsagePatch };
