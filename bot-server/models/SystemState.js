// models/SystemState.js
//
// Singleton holding the Spec Ops global switches:
//  - killswitch: stops the BOT from processing/replying on every channel; a
//    maintenance modal is shown to everyone below super_admin. Dashboard stays
//    usable for super_admin (so they can disengage).
//  - nuke: hard offline lockdown — the whole API returns 503 for everyone
//    (except /auth + /spec-ops so super_admin can recover) and the bot is dead.
//    Functionally "un-deployed", but the deployment/GitHub code are untouched and
//    it is fully reversible by super_admin.
const mongoose = require("mongoose");

const switchSchema = new mongoose.Schema(
  {
    engaged: { type: Boolean, default: false },
    at: { type: Date, default: null },
    by: { type: String, default: null }, // username/email of the super_admin who flipped it
  },
  { _id: false }
);

const systemStateSchema = new mongoose.Schema(
  {
    _id: { type: String, default: "singleton" },
    killswitch: { type: switchSchema, default: () => ({}) },
    nuke: { type: switchSchema, default: () => ({}) },
    // liberado: release gate. engaged=true → RELEASED (gated features open to all
    // per normal permissions; no daily conversation cap). Default OFF → the gated
    // features are super_admin-only and the bot is capped at 50 conversations/day.
    liberado: { type: switchSchema, default: () => ({}) },
  },
  { timestamps: true }
);

// Always operate on the one-and-only document.
systemStateSchema.statics.getState = async function () {
  let s = await this.findById("singleton");
  if (!s) s = await this.create({ _id: "singleton" });
  return s;
};

module.exports = mongoose.model("SystemState", systemStateSchema);
