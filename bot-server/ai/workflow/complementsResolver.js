// ai/workflow/complementsResolver.js
//
// Deterministic classify + resolve for the "Complementos de Instalación" flow.
// These are NAMED SKUs (not measure products), and the generic measure-oriented
// findProductInFamilies can't match them by natural names ("kit de instalación",
// "cordón uv", "ojillos 50") — so we resolve by the known family IDs instead.
//
//   Net the client has → complement(s):
//     confeccionada  → kit + cordón
//     rollo / ground cover → ojillos (sujetadores) + cordón
//   cordón = universal; kit = confeccionada only; ojillos = rollo/GC only.

const KIT_FAMILY_ID = "693cb0cac3b7d8cc1846b0b8"; // Kit de Instalación para Malla Sombra (leaf)
const CORDON_REALM_ID = "697bb117add8373c0e52faf8"; // Cordones y lazos → Lazo c/ UV → Rollo de 47 m
const OJILLOS_REALM_ID = "693cb2a7c3b7d8cc1846b130"; // Sujetadores Plásticos → Ojillos → Paquete de N piezas

const OJILLOS_PACKETS = [10, 20, 30, 35, 50, 100];

function norm(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Which net is the customer installing? (drives WHICH complement to recommend)
function classifyNet(message) {
  const m = norm(message);
  if (/confeccionad|reforzad|argolla|sin\s*refuerzo|a\s*la\s*medida|ya\s*hecha|ya\s*medida/.test(m)) return "confeccionada";
  if (/ground\s*cover|antimaleza|antimalez/.test(m)) return "groundcover";
  if (/\brollo\b|por\s*metro|en\s*rollo/.test(m)) return "rollo";
  return null;
}

// Which complement did the customer name directly? (null if none)
function classifyComplement(message) {
  const m = norm(message);
  if (/ojillo|sujetador/.test(m)) return "ojillos";
  if (/cord[o]n|lazo|cuerda|soga|amarr/.test(m)) return "cordon";
  if (/\bkit\b|instalaci|herraje/.test(m)) return "kit";
  return null;
}

// How many ojillos / which packet did they ask for?
//  - "paquete de 50", "los de 50", "50 piezas", "50 ojillos" → that packet
//  - a bare count ("necesito 45") → nearest packet >= count
function parseOjillosQty(message) {
  const m = norm(message);
  // explicit packet phrasing
  let mm =
    m.match(/(?:paquete|paq|bolsa)\s*(?:de\s*)?(\d{1,3})/) ||
    m.match(/(?:los|las|el|de)\s*(\d{1,3})\s*(?:piezas|pzas?|ojillos|sujetadores)?/) ||
    m.match(/(\d{1,3})\s*(?:piezas|pzas?|ojillos|sujetadores)/);
  if (mm) return parseInt(mm[1], 10);
  return null;
}

function nearestPacket(qty) {
  if (qty == null) return null;
  for (const p of OJILLOS_PACKETS) if (p >= qty) return p;
  return OJILLOS_PACKETS[OJILLOS_PACKETS.length - 1]; // 100 for anything bigger
}

// Links live in onlineStoreLinks[].url (NOT a flat `link` field).
function hasLink(d) {
  return Array.isArray(d?.onlineStoreLinks) && d.onlineStoreLinks.some((l) => l && l.url);
}

// Walk down a realm collecting every descendant family (BFS).
async function descendants(PF, rootId) {
  const out = [];
  let frontier = [rootId];
  for (let depth = 0; depth < 6 && frontier.length; depth++) {
    const kids = await PF.find({ parentId: { $in: frontier } })
      .select("name parentId onlineStoreLinks price mlPrice")
      .lean();
    out.push(...kids);
    frontier = kids.map((k) => k._id);
  }
  return out;
}

// Resolve the sellable doc for each complement, by known family IDs.
async function resolveKit(PF) {
  return PF.findById(KIT_FAMILY_ID).select("name onlineStoreLinks price mlPrice").lean();
}
async function resolveCordon(PF) {
  const ds = await descendants(PF, CORDON_REALM_ID);
  // the sellable leaf carries the link (e.g. "Rollo de 47 m"); prefer it
  return ds.find((d) => hasLink(d)) || ds.find((d) => /rollo|47/i.test(d.name)) || null;
}
async function resolveOjillosPacket(PF, packetN) {
  if (!packetN) return null;
  const ds = await descendants(PF, OJILLOS_REALM_ID);
  const re = new RegExp(`\\b${packetN}\\b`);
  return ds.find((d) => re.test(d.name) && /pieza|pza|ojillo/i.test(d.name)) || ds.find((d) => re.test(d.name)) || null;
}

// List the ojillos packets we carry (for "how many do you need?" context).
async function ojillosPackets(PF) {
  const ds = await descendants(PF, OJILLOS_REALM_ID);
  return ds
    .filter((d) => /pieza|pza/i.test(d.name))
    .map((d) => ({ name: d.name, n: parseInt((d.name.match(/\d{1,3}/) || [])[0], 10), price: d.price, hasLink: hasLink(d) }))
    .filter((d) => !isNaN(d.n))
    .sort((a, b) => a.n - b.n);
}

module.exports = {
  KIT_FAMILY_ID,
  CORDON_REALM_ID,
  OJILLOS_REALM_ID,
  OJILLOS_PACKETS,
  classifyNet,
  classifyComplement,
  parseOjillosQty,
  nearestPacket,
  resolveKit,
  resolveCordon,
  resolveOjillosPacket,
  ojillosPackets,
};
