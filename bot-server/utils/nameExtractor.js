// Extracts a customer's name from natural conversation messages.
// Patterns: "Soy Tony", "Me llamo María", "Sra. Leticia medina", "Habla Carlos",
// "Mi nombre es Juan", "Aquí Pedro", etc.
//
// Returns the cleaned first name (capitalized), or null if no name detected.

const NOT_NAMES = new Set([
  // Greetings / common words that often appear in name position
  'Hola', 'Buenos', 'Buenas', 'Saludos', 'Gracias', 'Adios', 'Adiós',
  'Bien', 'Mal', 'Si', 'Sí', 'No', 'Ok', 'Okay', 'Listo', 'Claro', 'Perfecto',
  // Product / commercial terms
  'Malla', 'Sombra', 'Precio', 'Costo', 'Medida', 'Envio', 'Envío', 'Tela',
  'Color', 'Rollo', 'Promo', 'Promoción', 'Producto', 'Compra',
  // Pronouns / generic
  'Yo', 'Tu', 'Tú', 'Él', 'El', 'Ella', 'Nosotros', 'Ellos', 'Ellas',
  'Mi', 'Tu', 'Su', 'Nuestro', 'Persona', 'Cliente', 'Vendedor', 'Vendedora',
  'Señor', 'Señora', 'Sra', 'Sr', 'Don', 'Doña',
  // Mexican locations frequently confused
  'Cdmx', 'Mexico', 'México', 'Guadalajara', 'Monterrey', 'Puebla',
  'Queretaro', 'Querétaro', 'Toluca', 'Tijuana', 'Cancun', 'Cancún',
  'Veracruz', 'Oaxaca', 'Chiapas', 'Yucatan', 'Yucatán', 'Sonora',
  'Estado', 'Ciudad', 'Pueblo', 'Colonia', 'Ocoyoacac',
  // Yes/no variants
  'Bueno', 'Buena', 'Vale', 'Va', 'Dale',
  // Confused/asking
  'Que', 'Qué', 'Como', 'Cómo', 'Cuanto', 'Cuánto', 'Cuando', 'Cuándo', 'Donde', 'Dónde',
  'Por', 'Para', 'Con', 'Sin', 'Hace',
  // Numbers spelled out
  'Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis', 'Siete', 'Ocho', 'Nueve', 'Diez',
  // Adjectives often used
  'Grande', 'Pequeño', 'Pequeña', 'Mediano', 'Mediana', 'Bonito', 'Bonita',
  'Caro', 'Cara', 'Barato', 'Barata',
  // Time
  'Hoy', 'Ayer', 'Mañana', 'Tarde', 'Noche', 'Dia', 'Día',
  // Time-related and common phrases
  'Necesito', 'Quiero', 'Tengo', 'Voy', 'Vengo',
  'Acaba', 'Lleg', 'Estaba',
  // Specific Spanish particle words
  'Soy', 'Es', 'Era', 'Estoy', 'Habla', 'Aqui', 'Aquí'
]);

const TITLE_PATTERN = /\b(?:sra\.?|sr\.?|señor(?:a|ita)?|se\xC3\xB1or(?:a|ita)?|don|do\xC3\xB1a|do[ñn]a|lic|licenciad[oa]|ing|ingenier[oa]|dr\.?|doctor[a]?)\.?/i;

/**
 * Capitalize the first letter and lowercase the rest.
 */
function capitalize(name) {
  if (!name) return null;
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

/**
 * Validate that a candidate string looks like a real name (not a common word).
 */
function isLikelyName(candidate) {
  if (!candidate) return false;
  const cleaned = candidate.trim();
  // Must be at least 2 chars, max 25 chars
  if (cleaned.length < 2 || cleaned.length > 25) return false;
  // Must be alphabetic only (allow accents and ñ)
  if (!/^[A-Za-zÁÉÍÓÚÑáéíóúñ]+$/.test(cleaned)) return false;
  // Reject if in NOT_NAMES (case-insensitive check by capitalizing first letter)
  const normalized = capitalize(cleaned);
  if (NOT_NAMES.has(normalized)) return false;
  // Reject obvious non-names (all uppercase, all lowercase short words)
  if (cleaned === cleaned.toUpperCase() && cleaned.length < 4) return false;
  return true;
}

/**
 * Try to extract a customer name from a single message.
 * Returns the capitalized first name or null.
 */
function extractName(message) {
  if (!message || typeof message !== 'string') return null;
  const text = message.trim();
  if (text.length < 3 || text.length > 200) return null;

  // Pattern 1: "Soy <Name>" / "Me llamo <Name>" / "Mi nombre es <Name>" / "Habla <Name>" / "Aquí <Name>"
  const introPatterns = [
    /\bsoy\s+(?:la|el)?\s*([A-ZÁÉÍÓÚÑa-záéíóúñ]+)(?:\s+([A-ZÁÉÍÓÚÑa-záéíóúñ]+))?\b/i,
    /\bme\s+llamo\s+(?:la|el)?\s*([A-ZÁÉÍÓÚÑa-záéíóúñ]+)(?:\s+([A-ZÁÉÍÓÚÑa-záéíóúñ]+))?\b/i,
    /\bmi\s+nombre\s+es\s+([A-ZÁÉÍÓÚÑa-záéíóúñ]+)(?:\s+([A-ZÁÉÍÓÚÑa-záéíóúñ]+))?\b/i,
    /\b(?:habla|le\s+habla)\s+([A-ZÁÉÍÓÚÑa-záéíóúñ]+)(?:\s+([A-ZÁÉÍÓÚÑa-záéíóúñ]+))?\b/i,
    /\baqu[ií]\s+([A-ZÁÉÍÓÚÑa-záéíóúñ]+)(?:\s+([A-ZÁÉÍÓÚÑa-záéíóúñ]+))?\b/i,
  ];

  for (const pattern of introPatterns) {
    const m = text.match(pattern);
    if (m && m[1]) {
      const candidate = m[1];
      if (isLikelyName(candidate)) return capitalize(candidate);
    }
  }

  // Pattern 2: "Sra. <Name>" / "Sr. <Name>" / "Lic. <Name>" / "Doctor <Name>" — title prefix
  // Allow no space after period: "Sra.leticia"
  const titleMatch = text.match(/\b(?:sra|sr|se[ñn]or(?:a|ita)?|don|do[ñn]a|lic|licenciad[oa]|ing|ingenier[oa]|dr|doctor[a]?)\.?[\s.]+([A-ZÁÉÍÓÚÑa-záéíóúñ]+)(?:\s+([A-ZÁÉÍÓÚÑa-záéíóúñ]+))?\b/i);
  if (titleMatch && titleMatch[1]) {
    const candidate = titleMatch[1];
    if (isLikelyName(candidate)) return capitalize(candidate);
  }

  // Pattern 3: "Mi/Mí nombre: X" or "Nombre: X" or "A nombre de X"
  const formalMatch = text.match(/(?:^|\b)(?:nombre|a\s+nombre\s+de)\s*:?\s+([A-ZÁÉÍÓÚÑa-záéíóúñ]+)(?:\s+([A-ZÁÉÍÓÚÑa-záéíóúñ]+))?\b/i);
  if (formalMatch && formalMatch[1]) {
    const candidate = formalMatch[1];
    if (isLikelyName(candidate)) return capitalize(candidate);
  }

  return null;
}

module.exports = { extractName, isLikelyName };
