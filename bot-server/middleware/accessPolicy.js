// ONE owner for "which LEVEL or PERMISSION an API call needs".
//
// The dashboard has a full permission system — role (super_admin > admin > super_user >
// user) plus a profile's list of SECTIONS — but until 2026-11-13 it lived in the menus
// only. The API never looked at it: any logged-in account could call the endpoint that
// rewrites a live Mercado Libre price, edit the bot's intents, or PUT /dashboard-users/:id
// and make itself super_admin (that route only restrained the role "admin").
//
// Two tables, on purpose:
//
//   LEVEL_RULES    — ENFORCED. What the dashboard already treats as super_admin-only,
//                    admin-only or super_user+ (App.js `filteredMenuItems` / `childVisible`).
//                    These are unambiguous, and admin / super_admin lose nothing.
//
//   SECTION_RULES  — OBSERVED, NOT YET ENFORCED. Which section a limited account must hold
//                    to use each API area. Pages share lookups freely (a campaign screen
//                    reads products, a chat reads tracked links), so a wrong row would
//                    break somebody's working screen and none of those accounts can be
//                    tested from here. Would-be refusals are counted in `access_observe`;
//                    once that shows only calls nobody should make, flip ENFORCE_SECTIONS.
//
// Pure: no I/O in this file. middleware/auth.js applies it.
const ENFORCE_SECTIONS = false;

const RANK = { user: 1, super_user: 2, admin: 3, super_admin: 4 };
const atLeast = (role, min) => (RANK[role] || 0) >= RANK[min];

const R = "R", W = "W", ANY = "*";
const kind = (method) => (method === "GET" || method === "HEAD" ? R : W);

// [kind, path regex, minimum role]. First match wins.
const LEVEL_RULES = [
  // Bot builder (legacy intents / flows): super_admin. Campaign modals only READ /flows.
  [ANY, /^\/intents(\/|$)/, "super_admin"],
  [ANY, /^\/intent-categories(\/|$)/, "super_admin"],
  [W, /^\/flows(\/|$)/, "super_admin"],
  // Playground: super_admin. /ml/playground can change a LIVE Mercado Libre price.
  [ANY, /^\/ml\/playground(\/|$)/, "super_admin"],
  [ANY, /^\/ml\/conversion-probability(\/|$)/, "super_admin"],
  [ANY, /^\/message-performance(\/|$)/, "super_admin"],
  [ANY, /^\/ai-usage(\/|$)/, "super_admin"],
  // Roles and profiles DEFINE the permission system: only super_admin changes them.
  // Admins read them to fill the user form.
  [W, /^\/roles(\/|$)/, "super_admin"],
  [W, /^\/profiles(\/|$)/, "super_admin"],
  [R, /^\/roles(\/|$)/, "admin"],
  [R, /^\/profiles(\/|$)/, "admin"],
  // The billing plan.
  [W, /^\/consumo(\/|$)/, "super_admin"],
  // Legacy bulk routes in index.js: every stored message / a Facebook profile sync.
  [ANY, /^\/messages\/?$/, "super_admin"],
  [ANY, /^\/sync-users\/?$/, "super_admin"],
  // Managing dashboard accounts: admin and up. (The route itself keeps an admin from
  // touching admins / super_admins.) Reading the list stays open: screens show names.
  [W, /^\/dashboard-users(\/|$)/, "admin"],
  [W, /^\/company-info(\/|$)/, "admin"],
  [ANY, /^\/assign-campaign(\/|$)/, "admin"],
  // Seguimiento Ground Cover: super_user and up.
  [ANY, /^\/gc-follow-up(\/|$)/, "super_user"],
];

function requiredLevel(method, path) {
  const k = kind(method);
  for (const [rk, re, min] of LEVEL_RULES) if ((rk === ANY || rk === k) && re.test(path)) return min;
  return null;
}

// [kind, path regex, sections — holding ANY one of them is enough]. First match wins.
// An area with no row is open to every logged-in account (shared lookups, own settings).
const CATALOG_EDIT = ["products", "families", "inventario", "master-catalog", "usos"];
const CAMPAIGN_EDIT = ["campaigns", "adsets", "ads", "ad-workflow", "campaign-overview"];
const NUMBERS = ["analytics", "overview", "campaign-overview", "ad-performance", "intelligence", "segmentacion", "forecast", "simulador", "spend-optimization"];
const SECTION_RULES = [
  [ANY, /^\/(conversations|api\/conversation|canned-messages|users)(\/|$)/, ["conversations", "crm-customers", "crm-sales"]],
  [ANY, /^\/crm(\/|$)/, ["crm-customers", "crm-sales", "conversations"]],
  [ANY, /^\/(analytics|sales-overview)(\/|$)/, NUMBERS],
  [R, /^\/ml(\/|$)/, [...NUMBERS, "inventario", "ml-orders", "ml-import", "ml-importer", "crm-sales"]],
  [W, /^\/ml(\/|$)/, ["inventario", "ml-import", "ml-importer"]],
  [W, /^\/(products|product-families|master-catalog|usos|grupos|points-of-sale)(\/|$)/, CATALOG_EDIT],
  [W, /^\/(campaigns|adsets|ads|campaign-products)(\/|$)/, CAMPAIGN_EDIT],
  [W, /^\/uploads(\/|$)/, [...CAMPAIGN_EDIT, ...CATALOG_EDIT]],
  [W, /^\/promos(\/|$)/, ["promos"]],
  [W, /^\/(convo-flows|flow-prompts)(\/|$)/, ["convo-flows"]],
  [ANY, /^\/cross-sell(\/|$)/, ["cross-sell"]],
  [W, /^\/workflows(\/|$)/, ["ad-workflow", "workflows"]],
  [R, /^\/consumo(\/|$)/, ["consumo", "overview"]],
  [W, /^\/click-logs(\/|$)/, ["tracked-links", "conversations", "campaign-overview", "overview"]],
];

function requiredSections(method, path) {
  const k = kind(method);
  for (const [rk, re, sections] of SECTION_RULES) if ((rk === ANY || rk === k) && re.test(path)) return sections;
  return null;
}

// The decision. `permissions` is the account's merged role + profile list.
//   { allow: true }                               go ahead
//   { allow: false, why }                         refuse (403)
//   { allow: true, observe: why }                 would be refused once sections are enforced
function decideAccess({ role, permissions }, method, path) {
  const min = requiredLevel(method, path);
  if (min && !atLeast(role, min)) return { allow: false, why: `requires ${min}` };

  const perms = Array.isArray(permissions) ? permissions : [];
  if (perms.includes("*")) return { allow: true };
  const need = requiredSections(method, path);
  if (!need || need.some((s) => perms.includes(s))) return { allow: true };
  const why = `needs one of: ${need.join(", ")}`;
  return ENFORCE_SECTIONS ? { allow: false, why } : { allow: true, observe: why };
}

module.exports = { decideAccess, requiredLevel, requiredSections, atLeast, LEVEL_RULES, SECTION_RULES, ENFORCE_SECTIONS };
