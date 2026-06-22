// utils/systemState.js
//
// Tiny cached reader for the Spec Ops switches so the per-message bot gate and
// the per-request API gate don't hit Mongo every time. Cache is invalidated the
// instant a switch is flipped (specOpsRoutes calls invalidate()).
const SystemState = require("../models/SystemState");

const TTL_MS = 5000;
let cache = { killswitch: false, nuke: false, at: 0 };

async function getHaltState() {
  if (Date.now() - cache.at > TTL_MS) {
    try {
      const s = await SystemState.getState();
      cache = {
        killswitch: !!(s.killswitch && s.killswitch.engaged),
        nuke: !!(s.nuke && s.nuke.engaged),
        at: Date.now(),
      };
    } catch (e) {
      // On a read error, fail OPEN (don't accidentally halt the business) but
      // keep the stale value if we had one.
      console.error("⚠️ systemState read failed:", e.message);
      cache.at = Date.now();
    }
  }
  return { killswitch: cache.killswitch, nuke: cache.nuke };
}

// True when the BOT must stay silent (either switch halts message processing).
async function isBotHalted() {
  const s = await getHaltState();
  return s.killswitch || s.nuke;
}

function invalidate() {
  cache.at = 0;
}

module.exports = { getHaltState, isBotHalted, invalidate };
