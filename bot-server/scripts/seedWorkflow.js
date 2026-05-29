// scripts/seedWorkflow.js
//
// Inserts a sample shade-net (malla sombra) Conversation Workflow so the sandbox
// has something to drive. Idempotent: upserts by name.
//
//   node scripts/seedWorkflow.js
require("dotenv").config();
const mongoose = require("mongoose");
const Workflow = require("../models/Workflow");

const SAMPLE = {
  name: "Malla Sombra — Venta Retail (demo)",
  description: "Flujo de ejemplo para venta de malla sombra confeccionada vía Mercado Libre.",
  active: false,
  globalPrompt: `Eres una asesora de ventas de Hanlob, fabricante mexicano de malla sombra y artículos para jardín.
Habla como una persona real por WhatsApp/Messenger: cálida, breve, natural. Español de México.
NUNCA suenes como un bot: no pidas números de opción, entiende lenguaje natural, maneja errores de dedo.
Solo vendemos malla sombra confeccionada al 90% y rollos al 35/50/70/80%. Nunca inventes precios ni porcentajes.
Responde en texto plano, sin markdown. Mantén los mensajes cortos (1-3 frases).`,
  variables: [
    { key: "first_name", description: "Nombre del cliente si se conoce" },
    { key: "brand", description: "Marca (Hanlob)" },
  ],
  knowledge: [
    { title: "Compra protegida", content: "La compra se realiza por Mercado Libre con compra protegida: si no llega o llega mal, se devuelve el dinero." },
    { title: "Pago contra entrega", content: "NO manejamos pago contra entrega salvo recoger en planta (Querétaro). El pago es al ordenar en ML." },
  ],
  startNode: "saludo",
  nodes: [
    {
      id: "saludo",
      name: "Saludo",
      kind: "llm",
      isStart: true,
      prompt: "Primer contacto. Saluda con calidez, preséntate brevemente como asesora de Hanlob y pregunta en qué medida o para qué espacio necesita la malla sombra.",
      toolsAllowed: ["note"],
      position: { x: 80, y: 80 },
    },
    {
      id: "descubrir",
      name: "Descubrir necesidad",
      kind: "llm",
      prompt: "El cliente mostró interés. Averigua la medida (ancho x largo) y el uso (patio, estacionamiento, cultivo). Si ya dio una medida, confírmala. No pidas todo de golpe.",
      toolsAllowed: ["ask_location", "note"],
      position: { x: 360, y: 80 },
    },
    {
      id: "cotizar",
      name: "Cotizar",
      kind: "llm",
      prompt: "Ya tienes medida y uso. Da una recomendación clara y comparte el link de compra del producto adecuado. Menciona compra protegida de Mercado Libre.",
      toolsAllowed: ["share_product_link", "share_store_link", "note"],
      position: { x: 640, y: 80 },
    },
    {
      id: "objecion",
      name: "Manejo de objeción",
      kind: "llm",
      prompt: "El cliente tiene una duda o preocupación (precio, confianza, envío). Resuélvela con empatía y datos reales (compra protegida, fabricante con experiencia). No discutas.",
      toolsAllowed: ["share_store_link", "note"],
      position: { x: 640, y: 320 },
    },
    {
      id: "cierre",
      name: "Cierre",
      kind: "llm",
      terminal: true,
      prompt: "El cliente está listo para comprar o ya tiene el link. Cierra con calidez, ofrece ayuda si la necesita y despídete brevemente.",
      toolsAllowed: ["capture_lead", "note"],
      position: { x: 920, y: 80 },
    },
    {
      id: "handoff",
      name: "Pasar a humano",
      kind: "auto",
      terminal: true,
      autoAction: { type: "handoff", text: "Con gusto te paso con un asesor que te atiende personalmente. Un momento por favor 🙏" },
      position: { x: 920, y: 320 },
    },
  ],
  edges: [
    { id: "e1", from: "saludo", to: "descubrir", condition: "El cliente respondió y mostró interés en la malla sombra." },
    { id: "e2", from: "descubrir", to: "cotizar", condition: "El cliente ya dio una medida (ancho x largo) y/o el uso." },
    { id: "e3", from: "cotizar", to: "cierre", condition: "El cliente aceptó, pidió el link, o dijo que va a comprar." },
    { id: "e4", from: "cotizar", to: "objecion", condition: "El cliente expresó una duda, queja o preocupación (precio, confianza, envío)." },
    { id: "e5", from: "objecion", to: "cotizar", condition: "La objeción quedó resuelta y el cliente sigue interesado." },
    { id: "e6", from: "objecion", to: "handoff", condition: "El cliente sigue molesto o pide hablar con una persona." },
    { id: "e7", from: "descubrir", to: "handoff", condition: "El cliente pide explícitamente hablar con un humano o compartió su teléfono." },
    { id: "e8", from: "cotizar", to: "handoff", condition: "El cliente pide hablar con un humano o es un caso de mayoreo/especial." },
  ],
};

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const existing = await Workflow.findOne({ name: SAMPLE.name });
  if (existing) {
    Object.assign(existing, SAMPLE);
    existing.version = (existing.version || 1) + 1;
    await existing.save();
    console.log(`🔄 Updated sample workflow: ${existing._id}`);
  } else {
    const wf = await Workflow.create(SAMPLE);
    console.log(`✅ Created sample workflow: ${wf._id}`);
  }
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
