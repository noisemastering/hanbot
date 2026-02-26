/**
 * Seed script for bot product flows.
 * Idempotent — upserts by `key`. Safe to run multiple times.
 *
 * Usage: node bot-server/scripts/seedFlows.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const Flow = require('../models/Flow');

const flows = [
  {
    key: 'malla_sombra',
    name: 'Malla sombra confeccionada (menudeo)',
    description: 'Flujo para venta de malla sombra confeccionada a medida. Menudeo vía Mercado Libre.',
    type: 'retail',
    steps: [
      { stepId: 'inicio', order: 1, message: 'Presenta producto y opciones disponibles' },
      { stepId: 'dimensiones', order: 2, message: 'Bot solicita medidas (largo x ancho) o m²' },
      { stepId: 'confirmacion', order: 3, message: 'Valida disponibilidad y confirma tamaño' },
      { stepId: 'foto_color', order: 4, message: 'Maneja solicitudes de fotos o colores' },
      { stepId: 'accesorios', order: 5, message: 'Ofrece lazo y kit de instalación' },
      { stepId: 'link_compra', order: 6, message: 'Genera link de compra con seguimiento' }
    ]
  },
  {
    key: 'rollo',
    name: 'Malla sombra en rollo (mayoreo)',
    description: 'Flujo para venta de rollos de malla sombra raschel. Mayoreo con cotización.',
    type: 'wholesale',
    steps: [
      { stepId: 'tipo_rollo', order: 1, message: 'Detecta o pregunta tipo de rollo' },
      { stepId: 'ancho', order: 2, message: 'Solicita ancho en metros' },
      { stepId: 'porcentaje', order: 3, message: 'Pregunta porcentaje de sombra' },
      { stepId: 'cantidad', order: 4, message: 'Solicita número de rollos' },
      { stepId: 'codigo_postal', order: 5, message: 'Pide CP para calcular envío' },
      { stepId: 'entrega', order: 6, message: 'Genera cotización y confirma envío' }
    ]
  },
  {
    key: 'groundcover',
    name: 'Ground cover (mayoreo)',
    description: 'Flujo para venta de ground cover / tela antimaleza en rollo. Usa el mismo motor que rolloFlow.',
    type: 'wholesale',
    steps: [
      { stepId: 'ancho', order: 1, message: 'Solicita ancho en metros' },
      { stepId: 'cantidad', order: 2, message: 'Solicita número de rollos' },
      { stepId: 'codigo_postal', order: 3, message: 'Pide CP para calcular envío' },
      { stepId: 'entrega', order: 4, message: 'Genera cotización y confirma envío' }
    ]
  },
  {
    key: 'monofilamento',
    name: 'Monofilamento (mayoreo)',
    description: 'Flujo para venta de malla monofilamento en rollo. Usa el mismo motor que rolloFlow.',
    type: 'wholesale',
    steps: [
      { stepId: 'ancho', order: 1, message: 'Solicita ancho en metros' },
      { stepId: 'porcentaje', order: 2, message: 'Pregunta porcentaje de sombra' },
      { stepId: 'cantidad', order: 3, message: 'Solicita número de rollos' },
      { stepId: 'codigo_postal', order: 4, message: 'Pide CP para calcular envío' },
      { stepId: 'entrega', order: 5, message: 'Genera cotización y confirma envío' }
    ]
  },
  {
    key: 'borde_separador',
    name: 'Borde separador de jardín',
    description: 'Flujo para venta de borde plástico separador de jardín. Menudeo vía Mercado Libre.',
    type: 'retail',
    steps: [
      { stepId: 'inicio', order: 1, message: 'Presenta borde separador y medidas disponibles' },
      { stepId: 'largo', order: 2, message: 'Solicita metros lineales (18m, 54m, etc.)' },
      { stepId: 'cantidad', order: 3, message: 'Pregunta cuántos rollos necesita' },
      { stepId: 'link_compra', order: 4, message: 'Genera link de compra con envío incluido' }
    ]
  },
  {
    key: 'lead_capture',
    name: 'Captura de leads / distribuidores',
    description: 'Flujo para captura de datos de distribuidores y clientes mayoristas interesados.',
    type: 'lead_capture',
    steps: [
      { stepId: 'catalogo', order: 1, message: 'Ofrece PDF de catálogo o cotización personalizada' },
      { stepId: 'nombre', order: 2, message: 'Solicita nombre del distribuidor/cliente' },
      { stepId: 'codigo_postal', order: 3, message: 'Pide CP o ciudad para ubicación' },
      { stepId: 'productos', order: 4, message: 'Solicita productos y medidas de interés' },
      { stepId: 'cantidad', order: 5, message: 'Pregunta cantidad aproximada' },
      { stepId: 'contacto', order: 6, message: 'Recopila WhatsApp o email' },
      { stepId: 'cierre', order: 7, message: 'Confirma datos y promete contacto de especialista' }
    ]
  }
];

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  for (const flow of flows) {
    const result = await Flow.findOneAndUpdate(
      { key: flow.key },
      { $set: flow },
      { upsert: true, new: true }
    );
    console.log(`  ${result.isNew !== false ? '✅ Created' : '🔄 Updated'}: ${flow.key} → ${flow.name}`);
  }

  console.log(`\nDone — ${flows.length} flows seeded.`);
  await mongoose.disconnect();
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
