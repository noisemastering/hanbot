// scripts/addressComposeTest.js
//
// `node scripts/addressComposeTest.js` — no DB, no LLM, no network.
//
// THE ADDRESS IS THE SINGLE SOURCE OF TRUTH AND NOTHING WE PRINT MAY CONTRADICT IT
// (2026-11-06). The record's `address` is the Colón plant and correct; the separate
// `city` field still reads "Santiago de Querétaro" (the site we left) and the stored
// `googleMapsUrl` is still the old Navex Park pin. The old composition glued the fields
// together blindly, so a pickup customer was shown an address ending in a town we left
// and, one line below it, a map of that same wrong town.
//
// The helpers are internal, so this drives them the way the manager does: through
// getBusinessInfo's own composition, with the DB stubbed.
const Module = require("module");
const origLoad = Module._load;
// Stub mongoose + the model BEFORE requiring the manager, so nothing touches the DB.
let INFO = {};
Module._load = function (req, parent, isMain) {
  if (req === "mongoose") return { model: () => ({}), models: {} };
  if (req.endsWith("models/CompanyInfo")) {
    return { findById: () => ({ lean: () => Promise.resolve(INFO) }), findOne: () => ({ lean: () => Promise.resolve(INFO) }) };
  }
  return origLoad(req, parent, isMain);
};
const B = require("../businessInfoManager");
Module._load = origLoad;

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`✅ ${l}`); };
const bad = (l, d) => { fail++; console.log(`❌ ${l}\n   ${d}`); };

async function compose(info) {
  INFO = info;
  B.invalidateCache();
  return await B.getBusinessInfo();
}

(async () => {
  // 1. TODAY'S REAL RECORD: a complete address + a city that contradicts it.
  {
    const b = await compose({
      address: "Carretera Estatal QRO 110, No. 7380, El Lindero, Colón, Querétaro, C.P. 76286, México.",
      city: "Santiago de Querétaro", state: "Querétaro", zipCode: "76286",
      googleMapsUrl: "https://www.google.com/maps/place/Malla+Sombra+Hanlob/@20.5946169,-100.4630917,17z",
    });
    b.fullAddress.includes("Colón") ? ok("keeps the real address") : bad("keeps the real address", b.fullAddress);
    !/Santiago de Quer/.test(b.fullAddress)
      ? ok("does NOT append the city the address contradicts")
      : bad("appended the stale city", b.fullAddress);
    (b.fullAddress.match(/76286/g) || []).length === 1
      ? ok("the C.P. appears once, not twice")
      : bad("duplicated the C.P.", b.fullAddress);
    !/20\.5946169/.test(b.googleMapsUrl) ? ok("ignores the old hand-typed pin") : bad("still the old pin", b.googleMapsUrl);
    /maps\/search/.test(b.googleMapsUrl) && /Col%C3%B3n/.test(b.googleMapsUrl)
      ? ok("derives the map FROM the address, so the two can't disagree")
      : bad("map not derived", b.googleMapsUrl);
    !/Santiago/.test(b.shortLocation) ? ok(`never announces the wrong city (says "${b.shortLocation}")`) : bad("short location", b.shortLocation);
  }
  // 2. A SHORT LINK THE TEAM PASTED is theirs and wins — they verified that place.
  {
    const b = await compose({ address: "QRO 110 7380, El Arroyito", city: "Colón", state: "Querétaro", zipCode: "76286",
      googleMapsUrl: "https://maps.app.goo.gl/7g9HmoY4TtaHQ26e8" });
    b.googleMapsUrl === "https://maps.app.goo.gl/7g9HmoY4TtaHQ26e8" ? ok("keeps a team-pasted short link") : bad("short link", b.googleMapsUrl);
    b.fullAddress === "QRO 110 7380, El Arroyito, Colón, Querétaro, C.P. 76286"
      ? ok("a street-only address still gets city/state/zip appended") : bad("street-only compose", b.fullAddress);
    b.shortLocation === "Colón, Querétaro" ? ok("city + state when they agree") : bad("shortLocation", b.shortLocation);
  }
  // 3. No data at all must not invent an address or a map.
  {
    const b = await compose({});
    !b.fullAddress || b.fullAddress.length < 3 ? ok("empty record → no invented address") : bad("invented", b.fullAddress);
    !b.googleMapsUrl ? ok("empty record → no invented map") : bad("invented map", b.googleMapsUrl);
  }
  console.log(`\n${pass}/${pass + fail} pass${fail ? ` — ${fail} FAILED` : ""}\n`);
  process.exit(fail ? 1 : 0);
})();
