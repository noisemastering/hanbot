// scripts/specops.js — flip the Spec Ops switches from the CLI (the verbal
// trigger path). Writes to the SAME Atlas DB the deployed server reads, so the
// live server picks it up within the cache TTL (≤5s).
//
//   node scripts/specops.js killswitch on        # stop the bot everywhere
//   node scripts/specops.js killswitch off       # resume
//   node scripts/specops.js nuke on  <word> <code>   # hard lockdown (needs secret)
//   node scripts/specops.js nuke off              # recover
//   node scripts/specops.js status
const mongoose = require("mongoose");
require("dotenv").config();
const SystemState = require("../models/SystemState");

const NUKE_SECRET_WORD = process.env.NUKE_SECRET_WORD || "FuckC0mm13S";
const NUKE_SECRET_CODE = process.env.NUKE_SECRET_CODE || "581206";

(async () => {
  const [, , sw, action, word, code] = process.argv;
  await mongoose.connect(process.env.MONGODB_URI);
  const s = await SystemState.getState();

  if (sw === "status" || !sw) {
    console.log("Spec Ops status:", JSON.stringify({ killswitch: s.killswitch, nuke: s.nuke }, null, 2));
    return mongoose.connection.close();
  }
  const on = action === "on" || action === "engage";

  if (sw === "killswitch") {
    s.killswitch = { engaged: on, at: on ? new Date() : null, by: on ? "cli" : null };
    await s.save();
    console.log(`🛑 Killswitch ${on ? "ENGAGED — bot stopped on all channels" : "released — bot resumed"}`);
  } else if (sw === "nuke") {
    if (on && (word !== NUKE_SECRET_WORD || String(code || "").trim() !== NUKE_SECRET_CODE)) {
      console.error("❌ Wrong secret code — Nuke'em NOT engaged.");
      process.exitCode = 1;
    } else {
      s.nuke = { engaged: on, at: on ? new Date() : null, by: on ? "cli" : null };
      await s.save();
      console.log(`☢️  Nuke'em ${on ? "ENGAGED — system OFFLINE (reversible; code preserved on GitHub)" : "DISARMED — system online"}`);
    }
  } else {
    console.error("Usage: specops.js killswitch|nuke on|off [word] [code] | status");
    process.exitCode = 1;
  }
  await mongoose.connection.close();
})().catch((e) => { console.error(e); process.exit(1); });
