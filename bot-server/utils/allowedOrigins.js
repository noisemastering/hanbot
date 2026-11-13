// ONE owner for "which web pages may call this API from a browser".
//
// The rule used to be `origin.includes('.vercel.app')`, which is not a list of our
// sites — it is every site hosted on Vercel, by anyone, plus any address that merely
// CONTAINS the text (https://x.vercel.app.example.com). Two retired addresses were
// also still trusted (an old *.vercel.app name and an ngrok tunnel); a name we no
// longer hold can be registered by somebody else, so they are gone.
//
// Matching is on the EXACT origin, never a substring. The express CORS layer and the
// socket.io one both read this, so they cannot drift (the socket list had already
// fallen behind and did not include the production dashboard).
const EXACT = new Set([
  "https://dashboard.hanlob.com.mx", // production dashboard
  "http://localhost:3000",           // local development
  "http://localhost:3001",
  "http://localhost:3002",
]);

// This project's own Vercel preview deployments, e.g.
//   https://hanbot-9emrx57im-sergio-patinos-projects.vercel.app
// The team suffix is ours; nobody else can publish under it.
const PREVIEW = /^https:\/\/hanbot-[a-z0-9-]+-sergio-patinos-projects\.vercel\.app$/;

function isAllowedOrigin(origin) {
  if (typeof origin !== "string") return false;
  return EXACT.has(origin) || PREVIEW.test(origin);
}

// For the `cors` package and socket.io alike. A request with NO Origin header is not a
// browser cross-site call (webhooks, health checks, tracked-link navigations), and CORS
// is not what protects those — the API guard is — so it passes through.
function corsOrigin(origin, callback) {
  if (!origin) return callback(null, true);
  if (isAllowedOrigin(origin)) return callback(null, true);
  callback(new Error("Not allowed by CORS"));
}

module.exports = { isAllowedOrigin, corsOrigin };
