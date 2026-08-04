// scripts/seedCannedMessages.js
//
// Seeds the initial canned messages (Noemi's WhatsApp saved replies). First one
// pinned; the rest fall into popularity order as they get used. Dynamic ones carry
// {{tokens}} resolved live at insert time (see utils/cannedTokens.js). Rollo 50%/35%
// are hardcoded to the message price per the user's explicit call.
//
// Usage: node scripts/seedCannedMessages.js [--wipe]
require("dotenv").config();
const mongoose = require("mongoose");

const MSGS = [
  { pinned: true, dynamic: true, title: "Saludo", body:
    "Buen día, con gusto te atiende {{agente}} de Hanlob" },

  { dynamic: false, title: "Porcentajes de sombra", body:
    "Con gusto te comparto información sobre nuestras mallas sombra tipo Raschel 🌱\n📌 Porcentajes de sombra disponibles:\n✅ 35%\n✅ 50%\n✅ 70%\n✅ 80%\n✅ 90%\nCada porcentaje es para una necesidad diferente según el cultivo o el uso que le quieras dar.\n👉 ¿Qué porcentaje de sombra necesitas y para qué cultivo o proyecto lo vas a usar?" },

  { dynamic: true, title: "Tienda Mercado Libre", body:
    "¡Hola! 😊\n\nQueremos invitarte a visitar nuestra tienda oficial en Mercado Libre. Allí encontrarás una gran variedad de productos disponibles, perfectos para lo que necesitas. No olvides seguirnos para estar siempre al tanto de nuestras ofertas exclusivas y promociones especiales.\n\n👉 Visítanos aquí: {{tienda}}\n\n¡Esperamos verte pronto!" },

  { dynamic: false, title: "Video presentación", body:
    "Le comparto el link del video de presentación de nuestra malla confeccionada.\n\nhttps://www.youtube.com/watch?v=O82IFkQf5AI" },

  { dynamic: true, title: "Promo Rollos 90%", body:
    "Te comparto nuestras promociones en Malla Sombra Raschel 90% (IVA incluido):\n\nRollo de 2 x 100 m: {{precio:MSR-ROL-90-BEI-02X100|2987}} + envío\nRollo de 3 x 100 m: {{precio:MSR-ROL-90-BEI-03X100|4480.50}} + envío\nRollo de 4 x 100 m: {{precio:MSR-ROL-90-BEI-04X100|5974}} + envío\nRollo de 5 x 100 m: {{precio:MSR-ROL-90-BEI-05X100|7467.50}} + envío\n\n📦 Contamos con descuentos especiales por compras al mayoreo.\n\n🏢 Somos tienda física ubicada en Querétaro y realizamos envíos a toda la República Mexicana.\n\nQuedo atento para cotizar el envío o resolver cualquier duda." },

  { dynamic: true, title: "Promo Rollos 80%", body:
    "🌞 Malla Sombra Raschel 80% de Sombreado\n\n✅ Protección UV para una mayor vida útil.\n✅ Fabricada con polietileno de alta densidad (HDPE).\n✅ Alta resistencia a la intemperie y al desgaste.\n\n📏 Medidas y precios:\n\n🔹 2.00 m x 100 m — 💰 {{precio:MSR-ROL-80-BEI-02X100|2143.69}} + envío\n🔹 4.20 m x 100 m — 💰 {{precio:MSR-ROL-80-BEI-04X100|4287.38}} + envío\n\n📦 Envíos a toda la República Mexicana.\n📲 Solicita tu cotización sin compromiso. 🌱🚚" },

  { dynamic: true, title: "Promo Rollos 70%", body:
    "Te comparto nuestras promociones en Malla Sombra Raschel 70% (IVA incluido):\n\nRollo de 2 x 100 m: {{precio:MSR-ROL-70-BEI-02X100|1670.40}} + envío\nRollo de 4.20 x 100 m: {{precio:MSR-ROL-70-BEI-04X100|3340.80}} + envío\n\n📦 Contamos con descuentos especiales por compras al mayoreo.\n\n🏢 Somos tienda física ubicada en Querétaro y realizamos envíos a toda la República Mexicana." },

  { dynamic: false, title: "Promo Rollos 50%", body:
    "Te comparto nuestras promociones en Malla Sombra Raschel 50% (IVA incluido):\n\nRollo de 4.20 x 100 m: $2,806.04 + envío\n\n📦 Contamos con descuentos especiales por compras al mayoreo.\n\n🏢 Somos tienda física ubicada en Querétaro y realizamos envíos a toda la República Mexicana.\n\nQuedo atento para cotizar el envío o resolver cualquier duda." },

  { dynamic: false, title: "Promo Rollos 35%", body:
    "Te comparto nuestras promociones en Malla Sombra Raschel 35% (IVA incluido):\n\nRollo de 4.20 x 100 m: $1,902.40 + envío\n\n📦 Contamos con descuentos especiales por compras al mayoreo.\n\n🏢 Somos tienda física ubicada en Querétaro y realizamos envíos a toda la República Mexicana.\n\nQuedo atento para cotizar el envío o resolver cualquier duda." },

  { dynamic: false, title: "Datos para cotizar (rollos)", body:
    "Para cotizarle el envío necesito:\n\n¿A nombre de quién hago la cotización?\nCódigo Postal\nColonia\n¿Qué rollos desea cotizar y cuántos?" },

  { dynamic: false, title: "Dirección / Ubicación", body:
    "Buen día, con gusto le atendemos. Estamos en Querétaro y despachamos a toda la República. Le comparto nuestra dirección y ubicación en Google Maps:\n\nHANLOB — Microparque Industrial Navex Park\nCalle Loma de San Gremal No. 108, bodega 73\nColonia Ejido Santa María Magdalena, 76137\nSantiago de Querétaro, Qro.\n\nhttps://www.google.com/maps/place/Hanlob/@20.5937761,-100.4633763,479m/data=!3m1!1e3!4m6!3m5!1s0x85d3512fd56b68f3:0x34ca9be8b6e65a52!8m2!3d20.5947278!4d-100.4629681!16s%2Fg%2F11fskp_mvj?hl=es-419&entry=ttu" },

  { dynamic: false, title: "Mayoreo desde 5 mallas", body:
    "🎉 ¡Precio de mayoreo desde 5 mallas! 🎉\n\nTe compartimos nuestra lista de precios actualizada, donde ahora puedes acceder a precio de mayoreo a partir de la compra de 5 mallas en adelante.\n\nEs una excelente oportunidad para comenzar o fortalecer tu venta de malla sombra con mejores márgenes, sin compras excesivas y de forma sencilla." },

  { dynamic: false, title: "Costo de envío", body:
    "Con respecto al envío, hacemos paquetes lo más compactos posible para incluir la mayor cantidad de mallas, así el envío te sale más económico. Nosotros te vendemos la guía de paquetería 📦 El costo aproximado del envío por malla es de $35 a $50." },

  { dynamic: false, title: "Cotización (datos)", body:
    "Con mucho gusto podemos elaborar una cotización sin ningún compromiso.\n\nPara brindarle una propuesta precisa, por favor compártanos la siguiente información:\n\n✅ Nombre de la persona o empresa a quien se emitirá la cotización.\n✅ Medidas de las mallas que requiere.\n✅ Cantidad de mallas de cada medida.\n✅ Código postal y colonia de entrega, para calcular el costo del flete.\n\nUna vez que nos proporcione estos datos, le enviaremos su cotización a la brevedad. Quedamos atentos a su información. 😊" },

  { dynamic: true, title: "Cómo comprar en Mercado Libre", body:
    "¡Hola! 😊 No te preocupes, entendemos que puedas tener dudas al comprar en línea, pero Mercado Libre es una plataforma muy segura y confiable.\n\n🔐 1. Crea una cuenta o inicia sesión en Mercado Libre.\nPuedes hacerlo con tu correo electrónico o con tu cuenta de Facebook/Google.\n🛒 2. Da clic en este enlace para ir directamente a nuestra tienda:\n👉 {{tienda}}\n✅ 3. Revisa los detalles del producto y haz clic en el botón que dice \"Comprar ahora\".\n📦 4. Ingresa tus datos de envío. Mercado Libre te muestra si el envío es gratis y en cuánto tiempo te llega.\n💳 5. Elige el método de pago que prefieras: tarjeta de crédito, débito, transferencia, efectivo en OXXO o Mercado Pago.\n📬 6. ¡Listo! Recibirás un correo con el seguimiento de tu pedido.\nY lo mejor: si algo no sale bien, Mercado Libre te protege y te devuelve tu dinero. 💵💛\nSi tienes más dudas, con gusto te ayudamos paso a paso. ¡Gracias por tu interés!" },

  { dynamic: true, title: "Antimaleza (Ground Cover)", body:
    "Malla Antimaleza (Ground Cover) marca HANLOB\n\nColor: Negro o Blanco\nMedidas:\n\nMalla Ground Cover 2 m x 100 m: {{precio:GC-ROL-NEG-02X100|2111.20}}\nMalla Ground Cover 4 m x 100 m: {{precio:GC-ROL-NEG-04X100|4222.40}}\n\nEsta malla de tejido cerrado es ideal para evitar el crecimiento de maleza, protegiendo tus cultivos al impedir que las malas hierbas absorban los nutrientes.\n\n📍 Estamos en Querétaro y realizamos envíos a todo el país." },

  { dynamic: false, title: "Contacto / WhatsApp", body:
    "Si tiene alguna otra pregunta o necesita más información, ¡estoy aquí para ayudarle! 💬\n\nQuedamos a sus órdenes para cualquier duda o asistencia adicional.\nPuede contactarnos al 442 595 7432\nhttps://wa.me/message/DEAUSSQARHGGG1" },

  { dynamic: false, title: "Medida especial (estructura)", body:
    "Por ser una malla de medida especial, requiere una ESTRUCTURA para ser soportada por su peso, y lleva costura de unión. Esto debe ser considerado para su instalación, y si no hay problema, continuamos con su cotización." },

  { dynamic: false, title: "No es impermeable", body:
    "No es completamente impermeable. Aunque ofrece un alto porcentaje de protección solar y ayuda a reducir el calor, está diseñada principalmente para proporcionar sombra, no para repeler agua. Puede resistir algo de lluvia ligera debido a su estructura, pero no está hecha para evitar filtraciones de agua en condiciones de lluvia intensa." },

  { dynamic: true, title: "Borde delimitador", body:
    "Agradecemos tu interés en nuestro ✳️ BORDE DELIMITADOR DE ESPACIOS DENTRO DEL JARDÍN ✨\nMARCA HANLOB\n\n☑️ IDEAL PARA PAISAJISMO\n✅ IDEAL PARA EMPRENDER TU NEGOCIO\n\n🟢 SOMOS FABRICANTES, VENDEMOS AL MAYOREO Y POR PIEZA 🟢\n\nContamos con variedad de medidas:\n✅ 9 m a solo: {{precio:CIN-BOR-GRU-09M|489}}\n✅ 18 m a solo: {{precio:CIN-BOR-GRU-18M|689}}\n✅ 54 m a solo: {{precio:CIN-BOR-GRU-54M|1599}}\n\nPuedes comprarlo entrando al siguiente link:\nhttps://agente.hanlob.com.mx/r/7461be1e" },
];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const CannedMessage = require("../models/CannedMessage");
  if (process.argv.includes("--wipe")) {
    const n = await CannedMessage.deleteMany({});
    console.log(`🧹 wiped ${n.deletedCount} existing`);
  }
  let created = 0;
  for (const [i, m] of MSGS.entries()) {
    // dedupe by title so re-runs update instead of duplicating
    await CannedMessage.updateOne(
      { title: m.title },
      { $set: { title: m.title, body: m.body, pinned: !!m.pinned, dynamic: !!m.dynamic, order: i, createdBy: "seed" } },
      { upsert: true }
    );
    created++;
  }
  console.log(`✅ seeded ${created} canned messages (pinned: ${MSGS.filter((m) => m.pinned).length})`);
  await mongoose.disconnect();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
