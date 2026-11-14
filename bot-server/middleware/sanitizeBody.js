// ONE owner for "a request body is DATA, never a database instruction".
//
// Mongo reads an object whose key starts with `$` as an operator. Almost every route
// here builds a filter straight from request fields — `find({ psid: req.body.psid })` —
// so a caller who sends `{"psid": {"$ne": null}}` in place of a string is no longer
// naming a record, they are writing the query ("every record whose psid is not null").
// The login accepted exactly that until 2026-11-14.
//
// Fixing it route by route means 250 routes each remembering to check; instead the keys
// are removed once, here, before any route runs. A `$`-prefixed key is dropped wherever
// it appears, at any depth. The dashboard never sends one (checked: no `$set`/`$in`/…
// in any request it builds), so nothing legitimate is lost. What is left behind is an
// empty object where a string was expected, which matches nothing.
//
// `__proto__` is dropped too: JSON.parse creates it as an ordinary key, and a careless
// deep-merge of such a body would rewrite Object.prototype for the whole process.
//
// QUERY STRINGS need no pass: Express 5 parses them "simple" — `?a[$ne]=1` arrives as
// the literal key "a[$ne]", never as a nested object. Do NOT switch the app to the
// "extended" query parser without extending this to req.query.
const BAD_KEY = (k) => k.startsWith("$") || k === "__proto__";

// Returns how many keys were removed. Mutates in place (arrays and nested objects too).
function scrub(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 40) return 0;
  let removed = 0;
  if (Array.isArray(value)) {
    for (const v of value) removed += scrub(v, depth + 1);
    return removed;
  }
  for (const k of Object.keys(value)) {
    if (BAD_KEY(k)) { delete value[k]; removed++; continue; }
    removed += scrub(value[k], depth + 1);
  }
  return removed;
}

function sanitizeBody(req, res, next) {
  try {
    const n = scrub(req.body);
    if (n) console.warn(`🧹 Removed ${n} operator key(s) from the body of ${req.method} ${req.path}`);
  } catch { /* a body we cannot walk is left for the route's own validation */ }
  next();
}

module.exports = { sanitizeBody, scrub };
