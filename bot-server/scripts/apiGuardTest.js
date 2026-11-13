// node scripts/apiGuardTest.js — no DB/LLM/network.
// The API guard's two load-bearing directions: what the outside world must still reach
// (webhooks, login, tracked links) stays open, and everything else is closed by default.
const path = require("path");
// The guard only touches the DB once a Bearer token is present; none of these cases send one.
require.cache[require.resolve(path.join("..", "models", "DashboardUser"))] = {
  exports: {
    // Only a well-formed, correctly signed token may reach the user lookup.
    findById: (id) => ({ select: async () => USERS[id] || null }),
  },
  loaded: true, id: "stub",
};
const USERS = { u1: { _id: "u1", role: "admin", active: true }, u2: { _id: "u2", role: "admin", active: false } };
delete process.env.JWT_SECRET; // the test signs with a throwaway secret of its own
process.env.JWT_SECRET = "test-only-secret";
const jwt = require("jsonwebtoken");
const { apiGuard, isPublic } = require("../middleware/auth");

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : (fail++, console.log("  ✗ " + name)); };

const open = [
  ["GET", "/webhook"], ["POST", "/webhook"], ["GET", "/webhook/whatsapp"], ["POST", "/webhook/whatsapp"],
  ["GET", "/health"], ["HEAD", "/health"],
  ["POST", "/auth/login"], ["POST", "/auth/forgot-password"], ["POST", "/auth/reset-password"],
  ["GET", "/auth/verify-reset-token"],
  ["GET", "/r/abc123"], ["GET", "/r/d/XYZ"],
  ["POST", "/ml/notifications"], ["GET", "/ml/notifications/ping"],
  ["GET", "/ml/oauth/callback"], ["GET", "/ml/oauth/authorize"],
  ["GET", "/push/vapid-key"],
];
const closed = [
  ["GET", "/conversations"], ["GET", "/conversations/123"], ["DELETE", "/conversations/123"],
  ["PATCH", "/conversations/123"], ["POST", "/assign-campaign/123"],
  ["GET", "/messages"], ["GET", "/users"], ["POST", "/sync-users"],
  ["GET", "/analytics/anything"], ["GET", "/products"], ["PUT", "/company-info"],
  ["POST", "/uploads/catalog/global"], ["GET", "/workflows"], ["GET", "/click-logs"],
  ["GET", "/health/status"], ["GET", "/health/alerts"],
  ["GET", "/ml/notifications/events"], ["GET", "/ml/items"], ["POST", "/ml/refresh"],
  ["GET", "/auth/me"], ["POST", "/auth/change-password"],
  ["POST", "/push/subscribe"], ["GET", "/spec-ops/status"],
  // near-misses of the public list must not ride along
  ["GET", "/webhookx"], ["GET", "/webhook/whatsapp/extra"], ["POST", "/health"],
  ["GET", "/auth/login"], ["POST", "/r/abc"], ["GET", "/rx/abc"],
  ["GET", "/ml/oauth/callback/extra"], ["DELETE", "/ml/notifications"],
  ["GET", "/a-route-nobody-has-written-yet"],
];
for (const [m, p] of open) ok(`open   ${m} ${p}`, isPublic(m, p) === true);
for (const [m, p] of closed) ok(`closed ${m} ${p}`, isPublic(m, p) === false);

// The guard itself: no token ⇒ 401 and the route never runs; public ⇒ next().
const run = (method, p, headers = {}) => new Promise((resolve) => {
  const res = { status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
  apiGuard({ method, path: p, headers }, res, () => resolve({ next: true }));
});
(async () => {
  for (const [m, p] of closed) { const r = await run(m, p); ok(`guard 401 ${m} ${p}`, r.code === 401 && !r.next); }
  for (const [m, p] of open) { const r = await run(m, p); ok(`guard pass ${m} ${p}`, r.next === true); }
  ok("preflight passes", (await run("OPTIONS", "/conversations")).next === true);
  ok("old static password is refused", (await run("GET", "/conversations", { authorization: "Bearer not-a-jwt" })).code === 401);
  ok("malformed header is refused", (await run("GET", "/conversations", { authorization: "Basic abc" })).code === 401);
  ok("empty bearer is refused", (await run("GET", "/conversations", { authorization: "Bearer " })).code === 401);
  const tok = (id, secret = "test-only-secret", opts = {}) => "Bearer " + jwt.sign({ id }, secret, opts);
  ok("valid token for an active user passes", (await run("GET", "/conversations", { authorization: tok("u1") })).next === true);
  ok("inactive user is refused", (await run("GET", "/conversations", { authorization: tok("u2") })).code === 401);
  ok("unknown user is refused", (await run("GET", "/conversations", { authorization: tok("ghost") })).code === 401);
  ok("token signed with another secret is refused", (await run("GET", "/conversations", { authorization: tok("u1", "some-other-secret") })).code === 401);
  ok("expired token is refused", (await run("GET", "/conversations", { authorization: tok("u1", "test-only-secret", { expiresIn: -10 }) })).code === 401);
  ok("unsigned (alg none) token is refused", (await run("GET", "/conversations", { authorization: "Bearer " + jwt.sign({ id: "u1" }, "", { algorithm: "none" }) })).code === 401);
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
