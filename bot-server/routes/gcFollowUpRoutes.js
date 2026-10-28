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
const { clusterReasons, stallPoints } = require("../jobs/gcReasonClusters");

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

// GET /gc-follow-up/reasons?scope=followup|convo&from=&to=&refresh=1
//
// "Why are customers not interested anymore" (the client, 2026-10-28). The grouped
// WHY, built from what the customers wrote and verified against it. Cached on a hash
// of those texts, so this is one model call per new batch of answers and not one per
// page load; `refresh=1` forces a fresh pass.
//
// The two scopes are returned separately on purpose and must not be summed: "followup"
// is a motive stated when we asked, "convo" is what a customer happened to say before
// going quiet.
router.get("/reasons", async (req, res) => {
  try {
    const out = await clusterReasons({
      scope: req.query.scope === "convo" ? "convo" : "followup",
      from: req.query.from,
      to: req.query.to,
      refresh: req.query.refresh === "1" || req.query.refresh === "true",
    });
    // The observed stall point rides along: it is deterministic and cheap, it covers
    // every conversation (not only the ones that stated a motive), and the two are
    // meant to be read side by side.
    const stalls = await stallPoints({ from: req.query.from, to: req.query.to }).catch((e) => {
      console.error("⚠️ stallPoints failed:", e.message);
      return null;
    });
    res.json({ success: true, ...out, stalls });
  } catch (e) {
    console.error("❌ /gc-follow-up/reasons failed:", e.message);
    res.status(500).json({ success: false, error: "No se pudieron agrupar los motivos" });
  }
});

module.exports = router;
