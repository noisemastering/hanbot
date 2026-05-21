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
        hours: (info.schedule || [])
          .filter(s => !s.closed && s.open && s.close)
          .map(s => `${s.day}: ${s.open} - ${s.close}`)
          .join(', ') || 'Lunes a Viernes de 8:00 a 18:00',
        address: info.address || '',
        city: info.city || '',
        state: info.state || '',
        zipCode: info.zipCode || '',
        fullAddress: [info.address, info.city, info.state, info.zipCode ? `C.P. ${info.zipCode}` : ''].filter(Boolean).join(', '),
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
    hours: "Lunes a Viernes de 8:00 a 18:00",
    address: "Microparque Industrial Navex Park, Querétaro",
    fullAddress: "Calle Loma de San Gremal No. 108, bodega 73, Microparque Industrial Navex Park, Col. Ejido Santa María Magdalena, C.P. 76137, Santiago de Querétaro, Qro.",
    googleMapsUrl: "https://www.google.com/maps/place/Malla+Sombra+Hanlob/@20.5946169,-100.4630917,17z",
    website: "https://hanlob.com.mx"
  };
}

// Backwards-compatible constants — now dynamic getters that use cache
// These are still used across many files via destructuring
let _mapsUrl = "https://www.google.com/maps/place/Malla+Sombra+Hanlob/@20.5946169,-100.4630917,17z";
let _storeAddress = "Calle Loma de San Gremal No. 108, bodega 73, Microparque Industrial Navex Park, Col. Ejido Santa María Magdalena, C.P. 76137, Santiago de Querétaro, Qro.";

// Warm the cache on module load (async, non-blocking)
CompanyInfo.findById("hanlob").lean().then(info => {
  if (info?.googleMapsUrl) _mapsUrl = info.googleMapsUrl;
  if (info?.address) {
    _storeAddress = [info.address, info.city, info.state, info.zipCode ? `C.P. ${info.zipCode}` : ''].filter(Boolean).join(', ');
  }
}).catch(() => {});

// Use defineProperty so MAPS_URL and STORE_ADDRESS always return the latest cached value
const _exports = { getBusinessInfo };
Object.defineProperty(_exports, 'MAPS_URL', { get: () => _mapsUrl });
Object.defineProperty(_exports, 'STORE_ADDRESS', { get: () => _storeAddress });

module.exports = _exports;
