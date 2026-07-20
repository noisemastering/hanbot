// ai/utils/convoIdentityExtractor.js
//
// Reads a conversation the way a human would and pulls out the CUSTOMER'S identity
// signals — name, city, state, zip — even when they're dropped in natural language
// ("envían a Tijuana", "soy de Guadalajara", "me llamo Bernardo", a name given after
// the bot asks). This replaces field-scraping, which misses most of the signal.
//
// Only the customer's OWN location/name is extracted. We feed ONLY user messages, so
// the store's own city ("estamos en Querétaro", said by the bot) never leaks in.

const { getTrackedClient } = require("../../utils/trackedOpenAI");

const SYSTEM = `Eres un extractor de identidad de clientes para una tienda mexicana de malla sombra. Te doy los mensajes del CLIENTE y, si existe, el SALUDO AUTOMÁTICO del asistente. Devuelve JSON:
{ "name": "<nombre del cliente si lo dio, o null>", "city": "<ciudad de ENVÍO/donde vive el cliente, o null>", "state": "<estado de la república, o null>", "zip": "<código postal de 5 dígitos, o null>" }

REGLAS:
- name — COSECHA DEL SALUDO PRIMERO: el asistente saluda al cliente por su nombre (viene de Meta), p. ej. "Hola Procoro, soy Claudia de Hanlob…" → name = "Procoro"; "¡Hola Ana Ruiz! Soy Fernanda…" → "Ana Ruiz". Si te doy un SALUDO AUTOMÁTICO, toma el nombre de AHÍ como PRIMERA fuente: es el nombre que sigue a "Hola/¡Hola!" y ANTES de "soy <asesora>". OJO: NO confundas el nombre de la ASESORA ("soy Claudia", "soy Fernanda") con el del cliente. Si el saludo NO trae nombre del cliente ("Hola, soy Claudia…") o no hay saludo, entonces busca el nombre en los mensajes del cliente.
- El SALUDO es del asistente: ÚSALO SÓLO para el name. NUNCA tomes ciudad/estado/CP del saludo (esos SÓLO salen de los mensajes del CLIENTE — el saludo puede mencionar "Querétaro" u otros datos de la tienda).
- name (respaldo, en los mensajes del cliente): el nombre del PROPIO cliente cuando lo da ("me llamo Bernardo", "soy Tony", "es para María Pérez", o responde su nombre tras pedírselo: "Bernardo Cruz"). NO inventes. Si no hay nombre claro en ningún lado → null.
- city / state: la ubicación del CLIENTE o a dónde quiere que le envíen, dicha en lenguaje natural: "envían a Tijuana", "soy de Guadalajara", "vivo en Monterrey", "aquí en Culiacán", "mando a Mérida Yucatán", "estoy en el estado de Puebla". Distingue ciudad de estado. Si solo dice el estado, deja city en null y llena state.
- NUNCA tomes "Querétaro" como ciudad del cliente si es la ubicación de la tienda; solo si el cliente dice que ÉL está/envía a Querétaro.
- zip: SOLO 5 dígitos que el cliente ESCRIBIÓ como su código postal (acepta con espacios: "630 23" = 63023). NUNCA infieras ni adivines un código postal a partir de la ciudad/estado; si el cliente no tecleó dígitos de CP → null.
- Extrae SOLO lo que el cliente realmente dijo. Ante la duda → null. Responde solo JSON, sin texto extra.`;

/**
 * Extract {name, city, state, zip} from a customer's messages.
 * @param {string[]} userMessages - the customer's message texts (bot messages excluded)
 * @param {object} [opts] - { model }
 * @returns {Promise<{name:string|null, city:string|null, state:string|null, zip:string|null}>}
 */
async function extractConvoIdentity(userMessages, opts = {}) {
  const empty = { name: null, city: null, state: null, zip: null };
  const msgs = (Array.isArray(userMessages) ? userMessages : [])
    .map((m) => String(m || "").trim())
    .filter(Boolean);
  if (!msgs.length) return empty;

  // Bound cost: identity is usually stated early/mid — cap to ~4000 chars.
  let joined = msgs.map((m, i) => `${i + 1}. ${m}`).join("\n");
  if (joined.length > 4000) joined = joined.slice(0, 4000);

  // Name harvesting: the automated greeting (a bot line, "Hola <Nombre>, soy …") is the
  // PRIMARY name source. Pass it separately so the model reads the name from it but never
  // takes location from it.
  const greeting = typeof opts.greeting === "string" && opts.greeting.trim()
    ? opts.greeting.trim().slice(0, 300)
    : null;
  const userContent = `${greeting ? `Saludo automático del asistente:\n${greeting}\n\n` : ""}Mensajes del cliente:\n${joined}`;

  try {
    const client = getTrackedClient();
    const res = await client.chat.completions.create({
      model: opts.model || "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userContent },
      ],
      temperature: 0,
      max_tokens: 120,
      response_format: { type: "json_object" },
    });
    const p = JSON.parse(res.choices[0].message.content);
    const clean = (v, max) =>
      v && typeof v === "string" && v.trim().length >= 2 ? v.trim().slice(0, max) : null;
    return {
      name: clean(p.name, 80),
      city: clean(p.city, 60),
      state: clean(p.state, 60),
      zip: p.zip && /^\d{5}$/.test(String(p.zip).trim()) ? String(p.zip).trim() : null,
    };
  } catch (err) {
    console.error("❌ extractConvoIdentity error:", err.message);
    return empty;
  }
}

module.exports = { extractConvoIdentity };
