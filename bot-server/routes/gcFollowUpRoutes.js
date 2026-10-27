// routes/gcFollowUpRoutes.js
//
// §6 + §8 of the Ground Cover campaign spec (client, 2026-10-27): the dashboard
// records every follow-up sent, whether the customer answered, and what the AI read in
// the answer — so the campaign can be judged on recovery AND on what we got wrong.
//
// Everything here is READ-ONLY except /run, which is a manual tick for testing. The
// switch itself lives in Spec Ops (POST /spec-ops/gc-follow-up).

const express = require("express");
const router = express.Router();
const { gcFollowUpStats, runGcFollowUpJob, runGcFollowUpReplyJob } = require("../jobs/gcFollowUp");

// GET /gc-follow-up/stats?from=&to=
router.get("/stats", async (req, res) => {
  try {
    const stats = await gcFollowUpStats({ from: req.query.from, to: req.query.to });
    res.json({ success: true, ...stats });
  } catch (e) {
    console.error("❌ /gc-follow-up/stats failed:", e.message);
    res.status(500).json({ success: false, error: "No se pudieron leer los seguimientos" });
  }
});

// POST /gc-follow-up/run — tick both jobs now. `dryRun: true` reports who WOULD get a
// follow-up without sending anything, which is the safe way to inspect the campaign
// before flipping the switch.
router.post("/run", async (req, res) => {
  try {
    const dryRun = !!req.body.dryRun;
    const send = await runGcFollowUpJob({ dryRun });
    const replies = await runGcFollowUpReplyJob();
    res.json({ success: true, dryRun, send, replies });
  } catch (e) {
    console.error("❌ /gc-follow-up/run failed:", e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
