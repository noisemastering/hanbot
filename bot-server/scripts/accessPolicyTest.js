// node scripts/accessPolicyTest.js — no DB/LLM/network.
// The real roles and profiles are inlined (read from the DB on 2026-11-13) so the cases
// are about the accounts that exist, not hypothetical ones.
const { decideAccess, ENFORCE_SECTIONS } = require("../middleware/accessPolicy");
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : (fail++, console.log("  ✗ " + n)); };

const SUPER_USER = ["conversations", "campaigns", "adsets", "ads", "products", "analytics", "families", "master-catalog", "usos", "overview"];
const A = {
  super_admin: { role: "super_admin", permissions: ["*"] },
  admin: { role: "admin", permissions: ["*"] },
  sales: { role: "super_user", permissions: [...SUPER_USER, "crm-customers", "crm-sales", "segmentacion", "spend-optimization"] },
  campaign_manager: { role: "user", permissions: ["conversations", "campaigns", "adsets", "ads", "products", "campaign-overview", "tracked-links", "ad-performance", "segmentacion", "spend-optimization", "simulador", "forecast", "intelligence", "convo-flows", "ad-workflow"] },
  salesman: { role: "user", permissions: ["conversations", "crm-customers"] },
  product_manager: { role: "user", permissions: ["inventario", "products", "campaigns", "conversations", "ads", "adsets", "families"] },
  nobody: { role: "user", permissions: [] },
  unknownRole: { role: "wizard", permissions: ["*"] },
};
const d = (who, m, p) => decideAccess(A[who], m, p);
const allowed = (who, m, p) => { const v = d(who, m, p); return v.allow && !v.observe; };
const refused = (who, m, p) => d(who, m, p).allow === false;
const flagged = (who, m, p) => { const v = d(who, m, p); return ENFORCE_SECTIONS ? v.allow === false : (v.allow && !!v.observe); };
const LIMITED = ["sales", "campaign_manager", "salesman", "product_manager", "nobody"];

// ---- super_admin can do everything; admin everything but the super_admin areas ----
const SUPER_ONLY = [
  ["GET", "/intents"], ["POST", "/intents"], ["DELETE", "/intents/abc"], ["GET", "/intent-categories"],
  ["POST", "/flows"], ["PUT", "/flows/abc"],
  ["GET", "/ml/playground/status"], ["PUT", "/ml/playground/item/MLM1/price"],
  ["GET", "/ml/conversion-probability"], ["GET", "/message-performance"], ["GET", "/ai-usage/summary"],
  ["POST", "/roles"], ["PUT", "/roles/abc"], ["DELETE", "/roles/abc"],
  ["POST", "/profiles"], ["PUT", "/profiles/abc"], ["DELETE", "/profiles/abc"],
  ["POST", "/consumo/plan"], ["GET", "/messages"], ["POST", "/sync-users"],
];
for (const [m, p] of SUPER_ONLY) {
  ok(`super_admin may ${m} ${p}`, allowed("super_admin", m, p));
  ok(`admin may NOT ${m} ${p}`, refused("admin", m, p));
  for (const who of LIMITED) ok(`${who} may NOT ${m} ${p}`, refused(who, m, p));
}

// ---- admin-level areas ----
const ADMIN_UP = [
  ["PUT", "/dashboard-users/abc"], ["POST", "/dashboard-users"], ["DELETE", "/dashboard-users/abc"],
  ["PUT", "/company-info"], ["POST", "/assign-campaign/123"], ["GET", "/roles"], ["GET", "/profiles"], ["GET", "/profiles/by-role/x"],
];
for (const [m, p] of ADMIN_UP) {
  ok(`admin may ${m} ${p}`, allowed("admin", m, p));
  ok(`super_admin may ${m} ${p}`, allowed("super_admin", m, p));
  for (const who of LIMITED) ok(`${who} may NOT ${m} ${p}`, refused(who, m, p));
}
// the reported escalation, spelled out: a limited account promoting itself
ok("a 'user' account cannot edit accounts (self-promotion)", refused("salesman", "PUT", "/dashboard-users/self"));
ok("a 'super_user' account cannot edit accounts", refused("sales", "PUT", "/dashboard-users/self"));
ok("a role that is not in the ladder gets nothing privileged", refused("unknownRole", "PUT", "/dashboard-users/x") && refused("unknownRole", "GET", "/gc-follow-up/stats"));

// ---- super_user and up ----
for (const [m, p] of [["GET", "/gc-follow-up/stats"], ["POST", "/gc-follow-up/run"]]) {
  ok(`sales (super_user) may ${m} ${p}`, allowed("sales", m, p));
  ok(`admin may ${m} ${p}`, allowed("admin", m, p));
  for (const who of ["campaign_manager", "salesman", "product_manager"]) ok(`${who} may NOT ${m} ${p}`, refused(who, m, p));
}

// ---- admins are never caught by a section row ----
for (const [m, p] of [["GET", "/conversations"], ["PUT", "/products/1"], ["POST", "/campaigns"], ["POST", "/ml/sync-prices"], ["POST", "/promos"], ["GET", "/analytics/x"], ["GET", "/flows"], ["GET", "/dashboard-users"], ["GET", "/company-info"]]) {
  ok(`admin may ${m} ${p}`, allowed("admin", m, p));
  ok(`super_admin may ${m} ${p}`, allowed("super_admin", m, p));
}

// ---- what each limited account's OWN screens call must pass cleanly ----
const OWN = {
  salesman: [["GET", "/conversations/grouped"], ["POST", "/api/conversation/1/takeover"], ["GET", "/crm"], ["PUT", "/crm/1"], ["GET", "/canned-messages"], ["GET", "/products"], ["GET", "/click-logs"], ["POST", "/tickets"], ["GET", "/notifications"], ["POST", "/auth/change-password"], ["GET", "/spec-ops/status"], ["GET", "/correlation/x"]],
  product_manager: [["GET", "/product-families/tree"], ["PUT", "/product-families/1"], ["POST", "/ml/sync-prices"], ["POST", "/uploads/catalog/product-family/1"], ["GET", "/conversations"], ["PUT", "/campaigns/1"], ["GET", "/promos"]],
  campaign_manager: [["POST", "/campaigns"], ["PUT", "/ads/1"], ["GET", "/analytics/x"], ["GET", "/ml/orders"], ["POST", "/click-logs/generate"], ["PUT", "/convo-flows/1"], ["PUT", "/workflows/ad/1"], ["GET", "/flows"], ["POST", "/uploads/catalog/ad/1"], ["GET", "/click-logs/stats"]],
  sales: [["GET", "/analytics/x"], ["GET", "/consumo/usage"], ["GET", "/crm/sales"], ["PUT", "/products/1"], ["POST", "/campaigns"], ["GET", "/ml/orders"], ["GET", "/conversations"]],
};
for (const [who, calls] of Object.entries(OWN)) for (const [m, p] of calls) ok(`${who} own screen: ${m} ${p}`, allowed(who, m, p));

// ---- section rows: flagged for accounts that do not hold the section ----
const OUTSIDE = [
  ["salesman", "PUT", "/products/1"], ["salesman", "POST", "/campaigns"], ["salesman", "GET", "/analytics/x"], ["salesman", "GET", "/ml/orders"], ["salesman", "POST", "/promos"], ["salesman", "POST", "/uploads/catalog/global"],
  ["product_manager", "GET", "/analytics/x"], ["product_manager", "POST", "/promos"], ["product_manager", "POST", "/cross-sell"],
  ["campaign_manager", "POST", "/cross-sell"], ["campaign_manager", "POST", "/ml/sync-prices"], ["campaign_manager", "POST", "/promos"],
  ["nobody", "GET", "/conversations"], ["nobody", "GET", "/crm"], ["nobody", "GET", "/analytics/x"],
];
for (const [who, m, p] of OUTSIDE) ok(`${who} outside own sections: ${m} ${p}`, flagged(who, m, p));
ok("section table is observe-only for now (flip deliberately)", ENFORCE_SECTIONS === false ? d("salesman", "PUT", "/products/1").allow === true : true);

// ---- path near-misses do not inherit a rule or dodge one ----
ok("/intentsx is not /intents", allowed("admin", "GET", "/intentsx"));
ok("/ml/playgroundx is not the playground", !refused("admin", "GET", "/ml/playgroundx"));
ok("HEAD is treated as a read", allowed("admin", "HEAD", "/roles") && refused("salesman", "HEAD", "/roles"));
ok("missing permissions list is treated as none", decideAccess({ role: "user" }, "GET", "/notifications").allow === true && decideAccess({ role: "user" }, "PUT", "/dashboard-users/x").allow === false);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
