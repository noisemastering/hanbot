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
    // Facebook COMMENT auto-reply. engaged=true → the bot publicly replies to page
    // comments (via the feed webhook). Default OFF. Also enableable via the
    // FB_COMMENT_AUTO_REPLY env var (either one turns it on).
    fbCommentReply: { type: switchSchema, default: () => ({}) },
    // Convo↔sale correlation freshness. `at` = when the last correlation run
    // finished; the dashboard auto-triggers a rebuild when it's >3h stale.
    // `running` guards against concurrent runs across requests/instances.
    lastCorrelationRun: {
      type: new mongoose.Schema(
        {
          at: { type: Date, default: null },
          running: { type: Boolean, default: false },
          startedAt: { type: Date, default: null },
          stats: { type: mongoose.Schema.Types.Mixed, default: null },
        },
        { _id: false }
      ),
      default: () => ({}),
    },
    // When the next scheduled (30-min) correlation is due — stamped each tick so
    // the dashboard can show a countdown.
    correlationNextAt: { type: Date, default: null },
    // Sales-reporting floor: the MINIMUM correlation certainty (%) that counts as a
    // REPORTED sale in the dashboard (chart/summary/table). Default 10. This is a
    // REPORTING filter ONLY — the correlation engine always stores every tier, even
    // the weakest, so raising/lowering this never loses data (weak matches are kept
    // for future use and simply hidden from the reports below the floor).
    salesReportingFloorPct: { type: Number, default: 10 },
    // Global dashboard banner (Spec Ops). When engaged, a warning banner is shown
    // across the WHOLE dashboard to every logged-in user. Toggled by super_admin.
    banner: {
      type: new mongoose.Schema(
        {
          engaged: { type: Boolean, default: false },
          message: {
            type: String,
            default: "El uso de OpenAI se está agotando, es necesario liberar el sistema para continuar operando",
          },
          at: { type: Date, default: null },
          by: { type: String, default: null },
        },
        { _id: false }
      ),
      default: () => ({}),
    },
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
