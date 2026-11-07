// businessInfoManager.js
// Reads company info from the CompanyInfo model (managed via dashboard).
// Provides backwards-compatible exports: getBusinessInfo(), MAPS_URL, STORE_ADDRESS.
// Uses a 5-minute cache to avoid hitting the DB on every bot message.

const CompanyInfo = require("./models/CompanyInfo");

let _cache = null;
let _cacheExpiry = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getBusinessInfo() {
  if (_cache && Date.now() < _cacheExpiry) return _cache;

  try {
    const info = await CompanyInfo.findById("hanlob").lean();
    if (info) {
      _cache = {
        name: info.name || 'Hanlob',
        phones: (info.phones || []).map(p => p.number).filter(Boolean),
        // Labelled phones ("Oficina" vs "WhatsApp"), because telling a customer
        // WHICH number is WhatsApp is the difference between a number they can
        // use and one they have to guess about.
        phonesLabelled: (info.phones || [])
          .filter(p => p && p.number)
          .map(p => ({ label: (p.label || "").trim(), number: p.number.trim() })),
        whatsappLink: info.whatsappLink || '',
        hours: (info.schedule || [])
          .filter(s => !s.closed && s.open && s.close)
          .map(s => `${s.day}: ${s.open} - ${s.close}`)
          .join(', ') || 'Lunes a Viernes de 8:00 a 18:00',
        address: info.address || '',
        city: info.city || '',
        state: info.state || '',
        zipCode: info.zipCode || '',
        fullAddress: fullAddressOf(info),
        shortLocation: shortLocationOf(info),
        googleMapsUrl: mapsUrlOf(info),
        website: info.website || '',
        catalog: info.catalog || {},
        social: info.social || {},
        marketplaces: info.marketplaces || [],
        // Raw data for anything that needs it
        _raw: info
      };
      _cacheExpiry = Date.now() + CACHE_TTL;
      return _cache;
    }
  } catch (err) {
    console.error("⚠️ Error reading CompanyInfo:", err.message);
  }

  // Fallback if DB read fails
  return {
    name: "Hanlob",
    phones: [],
    phonesLabelled: [],
    whatsappLink: '',
    hours: "Lunes a Viernes de 8:00 a 18:00",
    address: "Planta Colón, El Arroyito, Querétaro",
    shortLocation: "Colón, Querétaro",
    fullAddress: "QRO 110 7380, El Arroyito, Colón, Querétaro, C.P. 76286",
    googleMapsUrl: "https://maps.app.goo.gl/7g9HmoY4TtaHQ26e8",
    website: "https://hanlob.com.mx"
  };
}

// Drop the cache so the next getBusinessInfo() re-reads the DB. Call after any
// write to CompanyInfo (e.g. a catalog upload) so the bot picks it up immediately
// instead of waiting out the 5-minute TTL.
function invalidateCache() {
  _cache = null;
  _cacheExpiry = 0;
  warmConstants(); // fire-and-forget: refresh MAPS_URL / STORE_ADDRESS / SHORT_LOCATION too
}

// Backwards-compatible constants — now dynamic getters that use cache.
// ⚠️ Several callers DESTRUCTURE these (`const { MAPS_URL } = require(...)`), which
// reads the getter once at module load — before the async warm-up below resolves —
// so those copies are whatever the literals here say. That is why the literals must
// be kept correct and not treated as throwaway fallbacks: when Hanlob moved, a DB-only
// change would have left every destructured copy pointing at the old plant.
let _mapsUrl = "https://maps.app.goo.gl/7g9HmoY4TtaHQ26e8";
let _storeAddress = "QRO 110 7380, El Arroyito, Colón, Querétaro, C.P. 76286";
let _shortLocation = "Colón, Querétaro";

// THE ADDRESS IS THE SINGLE SOURCE OF TRUTH, AND THE SEPARATE FIELDS MUST NOT CONTRADICT
// IT (2026-11-06). The record's `address` is the Colón plant and correct; `city` still
// reads "Santiago de Querétaro" (the site we left) and `googleMapsUrl` is still the old
// Navex Park pin. The old code glued the fields together blindly —
// [address, city, state, C.P. zip].join(", ") — so a customer was shown
//   "…, Colón, Querétaro, C.P. 76286, México., Santiago de Querétaro, Querétaro, C.P. 76286"
// and, one line below it, a map of the previous town. Concatenating strings without
// looking at what they already say is the same blindness as matching words without
// reading the sentence.
//
// So: append a part ONLY when the address does not already carry it, and DERIVE the map
// from the address instead of trusting a stored pin that can rot while the address is
// updated. One source of truth, and the map can never disagree with the address printed
// above it.
const _plain = (v) =>
  String(v || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

function fullAddressOf(info) {
  const addr = String(info?.address || "").trim().replace(/[\s,.]+$/, "");
  const have = _plain(addr);
  // AN ADDRESS THAT CARRIES ITS OWN C.P. IS ALREADY COMPLETE — append nothing to it.
  // This is what the record holds today ("…, El Lindero, Colón, Querétaro, C.P. 76286,
  // México"), and the separate `city` field disagrees with it, so appending that field
  // produced an address ending in a town we left. The test is a fact about the string,
  // not an attempt to parse it: if the postal code is in there, the team wrote the whole
  // thing and nothing of ours belongs after it.
  const zip = _plain(info?.zipCode);
  if (zip && have.includes(zip)) return addr;
  const parts = [addr];
  for (const extra of [info?.city, info?.state, info?.zipCode ? `C.P. ${info.zipCode}` : ""]) {
    const v = String(extra || "").trim();
    if (!v) continue;
    const key = _plain(v).replace(/^c p /, ""); // "C.P. 76286" → "76286"
    if (key && have.includes(key)) continue; // the address already says it
    parts.push(v);
  }
  return parts.filter(Boolean).join(", ");
}

// A Google Maps link built from the address we are printing. A stored place pin is used
// ONLY when it is a link the team pasted themselves (maps.app.goo.gl short link); the
// hand-typed /@lat,lng pin in the record is from the old site and is ignored.
function mapsUrlOf(info) {
  const stored = String(info?.googleMapsUrl || "").trim();
  if (/maps\.app\.goo\.gl/i.test(stored)) return stored;
  const q = fullAddressOf(info);
  if (!q) return stored; // nothing better to offer
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

function shortLocationOf(info) {
  // Never announce a city the address contradicts ("Estamos en Santiago de Querétaro"
  // above an address in Colón). When they disagree, the STATE is true in both, and the
  // full address printed next to it carries the specifics.
  const city = String(info?.city || "").trim();
  const state = String(info?.state || "").trim();
  const addr = _plain(info?.address);
  const zip = _plain(info?.zipCode);
  // The city is only CONTRADICTED when the address is COMPLETE (it carries its own C.P.,
  // so the team wrote the whole thing) and that complete address does not name the city.
  // A street-only address simply doesn't mention its town — that is not a contradiction,
  // and the city field is the only place the town is written.
  const addressIsComplete = !!(zip && addr.includes(zip));
  if (city && addressIsComplete && !addr.includes(_plain(city))) {
    return state || city;
  }
  return shortLocationLegacy(info);
}

function shortLocationLegacy(info) {
  return [info?.city, info?.state]
    .map((v) => String(v || "").trim())
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i) // "Querétaro, Querétaro" reads badly
    .join(", ");
}

// Re-read the three constants from the DB. Called on module load AND from
// invalidateCache(), because they used to be warmed once at boot and never again:
// a dashboard edit to the address could not reach the bot without a redeploy.
function warmConstants() {
  return CompanyInfo.findById("hanlob").lean().then(info => {
    // Same two helpers getBusinessInfo uses: these constants are the DESTRUCTURED copies
    // six legacy call sites hold, so a different composition here would print a
    // different address than the engine does.
    const m = mapsUrlOf(info);
    if (m) _mapsUrl = m;
    if (info?.address) _storeAddress = fullAddressOf(info);
    const short = shortLocationOf(info);
    if (short) _shortLocation = short;
  }).catch(() => {});
}

// Warm the cache on module load (async, non-blocking)
warmConstants();

// Use defineProperty so MAPS_URL and STORE_ADDRESS always return the latest cached value
const _exports = { getBusinessInfo, invalidateCache };
Object.defineProperty(_exports, 'MAPS_URL', { get: () => _mapsUrl });
Object.defineProperty(_exports, 'STORE_ADDRESS', { get: () => _storeAddress });
// Where we ARE, in two words — "Colón, Querétaro". The city/state the customer
// recognises, with no street in it; five reply and prompt sites used to hardcode
// "Microparque Industrial Navex Park, Tlacote" instead and all five went stale at once.
Object.defineProperty(_exports, 'SHORT_LOCATION', { get: () => _shortLocation });

module.exports = _exports;
