const mongoose = require("mongoose");

const zipCodeSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, index: true },
  state: { type: String, required: true, index: true },
  stateCode: { type: String },
  municipality: { type: String, required: true },
  city: { type: String },
  zone: { type: String, enum: ['Urbano', 'Rural', 'Semiurbano'], default: 'Urbano' },
  // Shipping zone for delivery estimates
  shippingZone: {
    type: String,
    enum: ['metro', 'near', 'far', 'remote'],
    default: 'far'
  },
  // Neighborhoods (colonias) covered by this zip code
  neighborhoods: [{
    name: { type: String, required: true },
    type: { type: String } // Colonia, Fraccionamiento, Unidad habitacional, etc.
  }]
}, { timestamps: true });

// Helper to get shipping estimate based on zone
zipCodeSchema.methods.getShippingEstimate = function() {
  switch (this.shippingZone) {
    case 'metro':
      return { min: 1, max: 2, text: '1-2 días hábiles' };
    case 'near':
      return { min: 2, max: 3, text: '2-3 días hábiles' };
    case 'far':
      return { min: 3, max: 5, text: '3-5 días hábiles' };
    case 'remote':
      return { min: 5, max: 7, text: '5-7 días hábiles' };
    default:
      return { min: 3, max: 5, text: '3-5 días hábiles' };
  }
};

// Static to find and get location info by zipcode
zipCodeSchema.statics.lookup = async function(code) {
  const zip = await this.findOne({ code: code.toString().padStart(5, '0') });
  if (!zip) return null;

  return {
    code: zip.code,
    state: zip.state,
    municipality: zip.municipality,
    city: zip.city || zip.municipality,
    zone: zip.zone,
    shipping: zip.getShippingEstimate(),
    neighborhoods: zip.neighborhoods || [],
    hasMultipleNeighborhoods: (zip.neighborhoods?.length || 0) > 1
  };
};

// Static to find by city name (returns first match)
zipCodeSchema.statics.findByCity = async function(cityName) {
  const normalizedCity = cityName.toLowerCase().trim()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // Remove accents

  // Try exact match first (case-insensitive)
  let zip = await this.findOne({
    $or: [
      { city: { $regex: new RegExp(`^${cityName}$`, 'i') } },
      { municipality: { $regex: new RegExp(`^${cityName}$`, 'i') } }
    ]
  });

  // If no exact match, try partial match
  if (!zip) {
    zip = await this.findOne({
      $or: [
        { city: { $regex: new RegExp(cityName, 'i') } },
        { municipality: { $regex: new RegExp(cityName, 'i') } }
      ]
    });
  }

  if (!zip) return null;

  return {
    code: zip.code,
    state: zip.state,
    municipality: zip.municipality,
    city: zip.city || zip.municipality,
    zone: zip.zone
  };
};

// Static to find by state name
zipCodeSchema.statics.findByState = async function(stateName) {
  const zip = await this.findOne({
    state: { $regex: new RegExp(stateName, 'i') }
  });

  if (!zip) return null;

  return {
    state: zip.state,
    stateCode: zip.stateCode
  };
};

// Common aliases for Mexican locations
const LOCATION_ALIASES = {
  'cdmx': 'Ciudad de México',
  'df': 'Ciudad de México',
  'distrito federal': 'Ciudad de México',
  'queretaro': 'Santiago de Querétaro',
  'qro': 'Santiago de Querétaro',
  'leon': 'León',
  'slp': 'San Luis Potosí',
  'mty': 'Monterrey',
  'gdl': 'Guadalajara',
  'cancun': 'Cancún',
  'playa del carmen': 'Playa del Carmen',
  'san cristobal': 'San Cristóbal de las Casas',
  'oaxaca': 'Oaxaca de Juárez',
  'morelia': 'Morelia',
  'aguascalientes': 'Aguascalientes',
  'chihuahua': 'Chihuahua',
  'hermosillo': 'Hermosillo',
  'culiacan': 'Culiacán',
  'mexicali': 'Mexicali',
  'saltillo': 'Saltillo',
  'torreon': 'Torreón',
  'reynosa': 'Reynosa',
  'veracruz': 'Veracruz',
  'villahermosa': 'Villahermosa',
  'tuxtla': 'Tuxtla Gutiérrez',
  'tampico': 'Tampico',
  'celaya': 'Celaya',
  'irapuato': 'Irapuato',
  'pachuca': 'Pachuca de Soto',
  'toluca': 'Toluca de Lerdo',
  'cuernavaca': 'Cuernavaca',
  'acapulco': 'Acapulco de Juárez',
  'mazatlan': 'Mazatlán',
  'puerto vallarta': 'Puerto Vallarta',
  'los cabos': 'San José del Cabo',
  'la paz': 'La Paz',
  'campeche': 'Campeche',
  'chetumal': 'Chetumal',
  'colima': 'Colima',
  'durango': 'Durango',
  'tepic': 'Tepic',
  'zacatecas': 'Zacatecas'
};

// Static to validate if a location name exists (city, state, or municipality)
zipCodeSchema.statics.validateLocation = async function(locationName) {
  let name = locationName.trim().toLowerCase();

  // Check if it's a zipcode
  if (/^\d{5}$/.test(name)) {
    return await this.lookup(name);
  }

  // Check for common aliases
  if (LOCATION_ALIASES[name]) {
    name = LOCATION_ALIASES[name];
  }

  // Try as city
  const cityMatch = await this.findByCity(name);
  if (cityMatch) return cityMatch;

  // Try as state
  const stateMatch = await this.findByState(name);
  if (stateMatch) return stateMatch;

  return null;
};

module.exports = mongoose.model("ZipCode", zipCodeSchema);
