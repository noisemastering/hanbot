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
        fullAddress: [info.address, info.city, info.state, info.zipCode ? `C.P. ${info.zipCode}` : ''].filter(Boolean).join(', '),
        shortLocation: shortLocationOf(info),
        googleMapsUrl: info.googleMapsUrl || '',
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

function shortLocationOf(info) {
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
    if (info?.googleMapsUrl) _mapsUrl = info.googleMapsUrl;
    if (info?.address) {
      _storeAddress = [info.address, info.city, info.state, info.zipCode ? `C.P. ${info.zipCode}` : ''].filter(Boolean).join(', ');
    }
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
