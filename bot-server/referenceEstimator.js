// referenceEstimator.js - Estimate dimensions from common reference objects

/**
 * Common reference objects and their typical dimensions
 */
const REFERENCE_OBJECTS = {
  // Vehicles
  carro: { width: 2, height: 5, description: "un carro estándar (~2m x 5m)" },
  auto: { width: 2, height: 5, description: "un auto estándar (~2m x 5m)" },
  coche: { width: 2, height: 5, description: "un coche estándar (~2m x 5m)" },
  vehiculo: { width: 2, height: 5, description: "un vehículo estándar (~2m x 5m)" },
  automovil: { width: 2, height: 5, description: "un automóvil estándar (~2m x 5m)" },
  camioneta: { width: 2, height: 5.5, description: "una camioneta (~2m x 5.5m)" },
  pickup: { width: 2, height: 5.5, description: "una pickup (~2m x 5.5m)" },

  // Multiple vehicles
  "dos carros": { width: 4, height: 5, description: "dos carros (~4m x 5m)" },
  "2 carros": { width: 4, height: 5, description: "dos carros (~4m x 5m)" },
  "dos autos": { width: 4, height: 5, description: "dos autos (~4m x 5m)" },
  "2 autos": { width: 4, height: 5, description: "dos autos (~4m x 5m)" },

  // Patio/spaces
  "patio pequeño": { width: 3, height: 3, description: "un patio pequeño (~3m x 3m)" },
  "patio chico": { width: 3, height: 3, description: "un patio chico (~3m x 3m)" },
  "patio mediano": { width: 4, height: 4, description: "un patio mediano (~4m x 4m)" },
  "patio grande": { width: 5, height: 5, description: "un patio grande (~5m x 5m)" },

  // Outdoor spaces
  terraza: { width: 3, height: 4, description: "una terraza (~3m x 4m)" },
  cochera: { width: 3, height: 6, description: "una cochera (~3m x 6m)" },
  garage: { width: 3, height: 6, description: "un garage (~3m x 6m)" },
  estacionamiento: { width: 3, height: 6, description: "un estacionamiento (~3m x 6m)" }
};

/**
 * Extract reference object mention from message
 * @param {string} message - User's message
 * @returns {object|null} - Reference object info or null
 */
function extractReference(message) {
  const normalized = message.toLowerCase().trim();

  // Check for explicit multi-vehicle patterns first (more specific)
  const multiVehiclePatterns = [
    /(?:para\s+)?(?:dos|2)\s+(?:carros|autos|coches|vehiculos)/i,
  ];

  for (const pattern of multiVehiclePatterns) {
    if (pattern.test(normalized)) {
      const match = normalized.match(pattern);
      const key = match[0].replace(/para\s+/, '').trim();

      // Find matching key in REFERENCE_OBJECTS
      for (const [refKey, refData] of Object.entries(REFERENCE_OBJECTS)) {
        if (key.includes(refKey) || refKey.includes(key)) {
          return {
            reference: refKey,
            ...refData
          };
        }
      }
    }
  }

  // Check for size references (e.g., "del tamaño de un carro", "como un auto")
  const sizePatterns = [
    /(?:tamaño|tamano|medida|largo|ancho|grande|grandor)\s+(?:de|como|del|y\s+ancho\s+de)\s+(?:un|una|el|la)?\s*(\w+)/i,
    /(?:para|cubrir)\s+(?:un|una|el|la)?\s*(\w+)/i,
    /(?:como|del\s+porte\s+de)\s+(?:un|una)?\s*(\w+)/i
  ];

  for (const pattern of sizePatterns) {
    const match = normalized.match(pattern);
    if (match && match[1]) {
      const refObject = match[1].toLowerCase();

      // Check if it's in our reference objects
      if (REFERENCE_OBJECTS[refObject]) {
        return {
          reference: refObject,
          ...REFERENCE_OBJECTS[refObject]
        };
      }
    }
  }

  // Direct mention check (e.g., "patio grande", "cochera")
  for (const [key, data] of Object.entries(REFERENCE_OBJECTS)) {
    const pattern = new RegExp(`\\b${key}\\b`, 'i');
    if (pattern.test(normalized)) {
      return {
        reference: key,
        ...data
      };
    }
  }

  return null;
}

module.exports = {
  extractReference,
  REFERENCE_OBJECTS
};
