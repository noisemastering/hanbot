// node scripts/allowedOriginsTest.js — no DB/LLM/network.
const { isAllowedOrigin, corsOrigin } = require("../utils/allowedOrigins");
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : (fail++, console.log("  ✗ " + n)); };
const yes = [
  "https://dashboard.hanlob.com.mx",
  "http://localhost:3000", "http://localhost:3001", "http://localhost:3002",
  "https://hanbot-9emrx57im-sergio-patinos-projects.vercel.app",
  "https://hanbot-git-main-sergio-patinos-projects.vercel.app",
];
const no = [
  "https://evil.vercel.app",                                   // anyone's Vercel site
  "https://hanbot-nu.vercel.app",                              // a name we no longer hold
  "https://x.vercel.app.example.com",                          // merely contains the text
  "https://dashboard.hanlob.com.mx.example.com",
  "https://example.com/?https://dashboard.hanlob.com.mx",
  "http://dashboard.hanlob.com.mx",                            // not https
  "https://dashboard.hanlob.com.mx:8443",
  "https://sub.dashboard.hanlob.com.mx",
  "https://hanlob.com.mx",
  "https://hanbot-abc-someone-elses-projects.vercel.app",
  "https://nothanbot-abc-sergio-patinos-projects.vercel.app",
  "https://hanbot-abc-sergio-patinos-projects.vercel.app.example.com",
  "https://hanbot-abc-sergio-patinos-projects.vercel.app/",
  "https://emanational-leeanna-impressionable.ngrok-free.dev", // retired tunnel
  "http://localhost:4000", "http://127.0.0.1:3000", "https://localhost:3000",
  "null", "", "*",
];
for (const o of yes) ok("allow " + o, isAllowedOrigin(o));
for (const o of no) ok("refuse " + o, !isAllowedOrigin(o));
ok("non-string is refused", !isAllowedOrigin(undefined) && !isAllowedOrigin(null) && !isAllowedOrigin(["https://dashboard.hanlob.com.mx"]));
const run = (o) => { let r; corsOrigin(o, (e, v) => (r = { e, v })); return r; };
ok("no Origin header passes (webhooks, health checks)", run(undefined).v === true && !run(undefined).e);
ok("allowed origin passes", run("https://dashboard.hanlob.com.mx").v === true);
ok("foreign origin errors", run("https://evil.vercel.app").e instanceof Error);
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
