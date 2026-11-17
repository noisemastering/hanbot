#!/usr/bin/env node
// The turn reader's off switch. The reader (ai/workflow/turnReader.js) is ON by
// default; turning it OFF makes every gate fall back to its old regex, with no
// deploy. Takes effect within ~15 seconds (the engine caches the switch briefly).
//
//   node scripts/turnReaderSwitch.js status
//   node scripts/turnReaderSwitch.js off     # back to regex
//   node scripts/turnReaderSwitch.js on      # the model reads again
require("dotenv").config();
const mongoose = require("mongoose");
(async () => {
  const cmd = (process.argv[2] || "status").toLowerCase();
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const SystemState = require("../models/SystemState");
  const s = await SystemState.getState();
  if (cmd === "off" || cmd === "on") {
    s.turnReaderOff = { engaged: cmd === "off", at: new Date(), by: "scripts/turnReaderSwitch.js" };
    await s.save();
  }
  const off = !!(s.turnReaderOff && s.turnReaderOff.engaged);
  console.log(`turn reader: ${off ? "OFF — gates use regex (the old behaviour)" : "ON — the model reads every message"}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
