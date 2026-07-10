// utils/systemState.js
//
// Tiny cached reader for the Spec Ops switches so the per-message bot gate and
// the per-request API gate don't hit Mongo every time. Cache is invalidated the
// instant a switch is flipped (specOpsRoutes calls invalidate()).
const SystemState = require("../models/SystemState");

const TTL_MS = 5000;
// liberado defaults FALSE (restricted): fail-CLOSED so a release-gated feature
// never leaks to non-super-admins before it's explicitly released.
let cache = { killswitch: false, nuke: false, liberado: false, at: 0 };

async function getHaltState() {
  if (Date.now() - cache.at > TTL_MS) {
    try {
      const s = await SystemState.getState();
      cache = {
        killswitch: !!(s.killswitch && s.killswitch.engaged),
        nuke: !!(s.nuke && s.nuke.engaged),
        liberado: !!(s.liberado && s.liberado.engaged),
        at: Date.now(),
      };
    } catch (e) {
      // On a read error, fail OPEN for the HALT switches (don't accidentally halt
      // the business) but keep the stale value; liberado keeps its stale value too
      // (defaults restricted), so the gate stays safe.
      console.error("⚠️ systemState read failed:", e.message);
      cache.at = Date.now();
    }
  }
  return { killswitch: cache.killswitch, nuke: cache.nuke, liberado: cache.liberado };
}

// True when the BOT must stay silent (either switch halts message processing).
async function isBotHalted() {
  const s = await getHaltState();
  return s.killswitch || s.nuke;
}

// True when the system is RELEASED (Liberado ON). When false, gated features are
// super_admin-only and the bot is capped at 50 conversations/day.
async function isLiberado() {
  const s = await getHaltState();
  return s.liberado;
}

function invalidate() {
  cache.at = 0;
}

module.exports = { getHaltState, isBotHalted, isLiberado, invalidate };
