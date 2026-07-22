// routes/specOpsRoutes.js
//
// Super-admin "Spec Ops" controls:
//  - Killswitch: stop the bot everywhere + show a maintenance modal to everyone
//    below super_admin.
//  - Nuke'em: hard offline lockdown (whole API 503 except /auth + /spec-ops).
//    Arming requires the super_admin's password AND the two-part secret code.
//
// GET /spec-ops/status is readable by ANY authenticated user (the dashboard needs
// it to decide whether to show the maintenance modal). Mutations are super_admin.
const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const DashboardUser = require("../models/DashboardUser");
const SystemState = require("../models/SystemState");
const { invalidate } = require("../utils/systemState");

const JWT_SECRET = process.env.JWT_SECRET || "your-super-secret-jwt-key-change-in-production";

// Nuke'em secret code (two parts). Overridable via env, defaults to the agreed code.
const NUKE_SECRET_WORD = process.env.NUKE_SECRET_WORD || "FuckC0mm13S";
const NUKE_SECRET_CODE = process.env.NUKE_SECRET_CODE || "581206";

const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ success: false, error: "No token provided" });
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await DashboardUser.findById(decoded.id);
    if (!user || !user.active) {
      return res.status(401).json({ success: false, error: "Invalid token or inactive user" });
    }
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, error: "Invalid or expired token" });
  }
};

const requireSuperAdmin = (req, res, next) => {
  if (req.user.role !== "super_admin") {
    return res.status(403).json({ success: false, error: "Solo Super Admin puede operar Spec Ops" });
  }
  next();
};

router.use(authenticate);

const DEFAULT_BANNER = "El uso de OpenAI se está agotando, es necesario liberar el sistema para continuar operando";

const shape = (s) => ({
  killswitch: { engaged: !!s.killswitch?.engaged, at: s.killswitch?.at || null, by: s.killswitch?.by || null },
  nuke: { engaged: !!s.nuke?.engaged, at: s.nuke?.at || null, by: s.nuke?.by || null },
  liberado: { engaged: !!s.liberado?.engaged, at: s.liberado?.at || null, by: s.liberado?.by || null },
  banner: { engaged: !!s.banner?.engaged, message: s.banner?.message || DEFAULT_BANNER, at: s.banner?.at || null, by: s.banner?.by || null },
  fbCommentReply: { engaged: !!s.fbCommentReply?.engaged, at: s.fbCommentReply?.at || null, by: s.fbCommentReply?.by || null },
});

// Status — any authenticated user (drives the maintenance modal).
router.get("/status", async (req, res) => {
  try {
    const s = await SystemState.getState();
    res.json({ success: true, ...shape(s) });
  } catch (e) {
    res.status(500).json({ success: false, error: "No se pudo leer el estado" });
  }
});

// Killswitch — super_admin. Body: { engage: boolean }
router.post("/killswitch", requireSuperAdmin, async (req, res) => {
  try {
    const engage = !!req.body.engage;
    const s = await SystemState.getState();
    s.killswitch = { engaged: engage, at: engage ? new Date() : null, by: engage ? (req.user.username || req.user.email || "super_admin") : null };
    await s.save();
    invalidate();
    console.warn(`🛑 [SpecOps] Killswitch ${engage ? "ENGAGED" : "released"} by ${req.user.username || req.user.email}`);
    res.json({ success: true, ...shape(s) });
  } catch (e) {
    res.status(500).json({ success: false, error: "No se pudo cambiar el killswitch" });
  }
});

// Nuke'em — super_admin + password + two-part secret. Body to ARM:
// { engage: true, password, secretWord, secretCode }. To DISARM (recover):
// { engage: false, password }.
router.post("/nuke", requireSuperAdmin, async (req, res) => {
  try {
    const { engage, password, secretWord, secretCode } = req.body;
    if (!password) return res.status(400).json({ success: false, error: "Contraseña requerida" });
    const ok = await req.user.comparePassword(password);
    if (!ok) return res.status(403).json({ success: false, error: "Contraseña incorrecta" });

    if (engage) {
      if (secretWord !== NUKE_SECRET_WORD || String(secretCode || "").trim() !== NUKE_SECRET_CODE) {
        return res.status(403).json({ success: false, error: "Código secreto incorrecto" });
      }
    }

    const s = await SystemState.getState();
    s.nuke = { engaged: !!engage, at: engage ? new Date() : null, by: engage ? (req.user.username || req.user.email || "super_admin") : null };
    await s.save();
    invalidate();
    console.warn(`☢️  [SpecOps] Nuke'em ${engage ? "ENGAGED — system OFFLINE" : "DISARMED — system online"} by ${req.user.username || req.user.email}`);
    res.json({ success: true, ...shape(s) });
  } catch (e) {
    res.status(500).json({ success: false, error: "No se pudo cambiar Nuke'em" });
  }
});

// Liberado — super_admin. Body: { engage: boolean }. engage=true → RELEASED.
router.post("/liberado", requireSuperAdmin, async (req, res) => {
  try {
    const engage = !!req.body.engage;
    const s = await SystemState.getState();
    s.liberado = { engaged: engage, at: engage ? new Date() : null, by: engage ? (req.user.username || req.user.email || "super_admin") : null };
    await s.save();
    invalidate();
    console.warn(`🚀 [SpecOps] Liberado ${engage ? "ON — features released, cap lifted" : "OFF — gated to super_admin, 50/day cap"} by ${req.user.username || req.user.email}`);
    res.json({ success: true, ...shape(s) });
  } catch (e) {
    res.status(500).json({ success: false, error: "No se pudo cambiar Liberado" });
  }
});

// Global dashboard banner — super_admin. Body: { engage: boolean, message?: string }.
// engage=true → the warning banner shows across the whole dashboard for everyone.
router.post("/banner", requireSuperAdmin, async (req, res) => {
  try {
    const engage = !!req.body.engage;
    const s = await SystemState.getState();
    const msg = typeof req.body.message === "string" && req.body.message.trim()
      ? req.body.message.trim()
      : (s.banner?.message || DEFAULT_BANNER);
    s.banner = {
      engaged: engage,
      message: msg,
      at: engage ? new Date() : (s.banner?.at || null),
      by: engage ? (req.user.username || req.user.email || "super_admin") : (s.banner?.by || null),
    };
    await s.save();
    invalidate();
    console.warn(`📣 [SpecOps] Banner ${engage ? "ON" : "off"} by ${req.user.username || req.user.email}`);
    res.json({ success: true, ...shape(s) });
  } catch (e) {
    res.status(500).json({ success: false, error: "No se pudo cambiar el banner" });
  }
});

// FB comment auto-reply — super_admin. Body: { engage: boolean }. engage=true → the
// bot publicly replies to page comments.
router.post("/fb-comment-reply", requireSuperAdmin, async (req, res) => {
  try {
    const engage = !!req.body.engage;
    const s = await SystemState.getState();
    s.fbCommentReply = { engaged: engage, at: engage ? new Date() : null, by: engage ? (req.user.username || req.user.email || "super_admin") : null };
    await s.save();
    invalidate();
    console.warn(`💬 [SpecOps] FB comment auto-reply ${engage ? "ON" : "off"} by ${req.user.username || req.user.email}`);
    res.json({ success: true, ...shape(s) });
  } catch (e) {
    res.status(500).json({ success: false, error: "No se pudo cambiar el auto-reply de comentarios" });
  }
});

module.exports = router;
