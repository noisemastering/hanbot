// ONE owner for "who may call this API".
//
// Authentication used to be a helper copy-pasted into 20 route files, and a route file
// that never pasted it was simply open — 25 of 47 were, along with several routes
// declared straight in index.js. A rule that each file must remember is a rule that
// gets forgotten, so the default is inverted here: `apiGuard` runs before every route
// and EVERYTHING requires a logged-in dashboard user unless it is on the short PUBLIC
// list below. A new route is private the moment it is written.
//
// The per-file `authenticate` helpers still exist and still run; they are now redundant
// rather than load-bearing, and role checks (requireSuperAdmin) stay where they are.
const jwt = require("jsonwebtoken");
const DashboardUser = require("../models/DashboardUser");

const { getJwtSecret } = require("../utils/jwtSecret");

// [method, path] pairs reachable with no token. Each one is here for a reason:
const PUBLIC = [
  // Meta / WhatsApp deliver here; they authenticate with their own verify token + signature.
  ["*", /^\/webhook(\/whatsapp)?\/?$/],
  // Uptime check. (The /health/* sub-routes carry dashboard data and are NOT public.)
  ["GET", /^\/health\/?$/],
  // You cannot hold a token before logging in or while resetting a password.
  ["POST", /^\/auth\/(login|logout|forgot-password|reset-password)\/?$/],
  ["GET", /^\/auth\/verify-reset-token\/?$/],
  // Tracked links customers click from Messenger / WhatsApp.
  ["GET", /^\/r\//],
  // Mercado Libre delivers notifications and the OAuth redirect lands here.
  ["POST", /^\/ml\/notifications\/?$/],
  ["GET", /^\/ml\/notifications\/ping\/?$/],
  ["GET", /^\/ml\/oauth\/(authorize|callback)\/?$/],
  // The browser needs the PUBLIC push key before it can subscribe.
  ["GET", /^\/push\/vapid-key\/?$/],
];

function isPublic(method, path) {
  const m = method === "HEAD" ? "GET" : method;
  return PUBLIC.some(([pm, re]) => (pm === "*" || pm === m) && re.test(path));
}

// Resolves the dashboard user behind a request, or null. Never throws.
async function userFromRequest(req) {
  try {
    const header = req.headers.authorization || "";
    if (!/^Bearer\s+\S/.test(header)) return null;
    const decoded = jwt.verify(header.replace(/^Bearer\s+/, ""), await getJwtSecret());
    const user = await DashboardUser.findById(decoded.id).select("-password -resetPasswordToken -resetPasswordExpires");
    if (!user || !user.active) return null;
    // A token issued before the password last changed belongs to a session that the
    // change was meant to end. (1 s of slack: `iat` is in whole seconds.)
    if (user.passwordChangedAt && decoded.iat * 1000 < user.passwordChangedAt.getTime() - 1000) return null;
    return user;
  } catch {
    return null;
  }
}

async function authenticate(req, res, next) {
  const user = await userFromRequest(req);
  if (!user) return res.status(401).json({ success: false, error: "Unauthorized" });
  req.user = user;
  next();
}

function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== "super_admin") {
    return res.status(403).json({ success: false, error: "Forbidden" });
  }
  next();
}

// ---- level / permission (middleware/accessPolicy.js decides; this applies it) ----
const { decideAccess } = require("./accessPolicy");

// An account's merged role + profile permissions. Cached briefly: it costs two queries
// and is asked on every request; a change made in the dashboard lands within a minute.
const permCache = new Map(); // userId -> { at, perms }
async function permissionsOf(user) {
  if (user.role === "super_admin" || user.role === "admin") return ["*"];
  const key = String(user._id);
  const hit = permCache.get(key);
  if (hit && Date.now() - hit.at < 60000) return hit.perms;
  let perms = [];
  try { perms = (await user.getAllPermissions()) || []; } catch { perms = []; }
  permCache.set(key, { at: Date.now(), perms });
  return perms;
}

// Would-be refusals while the section table is only observed. One small document per
// (role, profile, method kind, API area), so the collection stays tiny.
function noteObserved(user, method, path, why) {
  try {
    const area = "/" + (path.split("/")[1] || "");
    const k = method === "GET" || method === "HEAD" ? "R" : "W";
    require("mongoose").connection.collection("access_observe").updateOne(
      { _id: `${user.role}|${user.profile || "-"}|${k}|${area}` },
      { $inc: { count: 1 }, $set: { lastPath: path.slice(0, 120), lastAt: new Date(), why } },
      { upsert: true }
    ).catch(() => {});
  } catch { /* observing must never break a request */ }
}

async function authorize(req, res, next) {
  const verdict = decideAccess({ role: req.user.role, permissions: await permissionsOf(req.user) }, req.method, req.path);
  if (!verdict.allow) return res.status(403).json({ success: false, error: "Forbidden" });
  if (verdict.observe) noteObserved(req.user, req.method, req.path, verdict.observe);
  next();
}

// Mounted once, ahead of every route: WHO are you, then MAY you.
function apiGuard(req, res, next) {
  if (req.method === "OPTIONS") return next(); // CORS preflight carries no credentials
  if (isPublic(req.method, req.path)) return next();
  return authenticate(req, res, () => authorize(req, res, next).catch(next));
}

module.exports = { apiGuard, authenticate, requireSuperAdmin, userFromRequest, isPublic, PUBLIC };
