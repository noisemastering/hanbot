// scripts/closeFixedTickets_2026-11-02.js
//
// One-off: close the reported conversations fixed on 2026-11-02 and leave a
// resolution note on the two that are NOT fixed, so /reported-convos says WHY
// instead of just showing them as open.
//
// `resolvedBy` is deliberately left null: nobody on the team clicked Resuelto.
// Dry run by default; --write applies.
require("dotenv").config();
const mongoose = require("mongoose");
const Ticket = require("../models/Ticket");

const SOLVED = [
  ["sbx_1793642155360_nmzv7u", "Arreglado (a024746). En el flujo Ground Cover el cliente pidió BORDE PLÁSTICO y se le contestó tres veces con los precios de la antimaleza. Ahora ninguna compuerta contesta por un producto que su flujo no vende (namesOtherProduct) y el cambio a Borde separador ocurre en el primer mensaje. Además el clasificador ya entiende la forma negativa: '¿no vendes borde plástico?' sí nombra el producto."],
  ["wa:5215549680085", "Arreglado (a024746). 'Malla Anti malesa' en el flujo de borde recibía el aviso de 'ya te pasé los precios'. Ahora cambia a Ground Cover y entrega sus precios."],
  ["wa:5219541278285", "Arreglado (a024746). Preguntó tres veces por el envío y recibió tres veces el mismo aviso: el flujo de borde NO tenía compuerta de envío. Ahora responde los dos casos (los rollos de 6, 9 y 18 m que se compran en línea llevan el envío incluido; el de 54 m va por flete y se cotiza con el CP) y también el tiempo de entrega."],
  ["wa:5214443475099", "Arreglado (a024746). '¿En dónde se consigue?' recibía el aviso de precios. Ahora se contesta el canal: tienda oficial de Mercado Libre, compra directa por transferencia con envío a toda la República, o pago en tienda, más la dirección."],
  ["9864541876987642", "Arreglado (a024746). El cliente escribió 'Gracias por tu atención' y eso disparó la alerta con un lead sin un solo dato. Una respuesta de cortesía ya no escala: se cierra con amabilidad y no se molesta a ventas."],
  ["9842980679120728", "Arreglado (a024746). Lo mismo con un '😏': ya no genera alerta. La verificación de contacto pasa por handoffContactOf, así que un nombre solo no cuenta como forma de contacto."],
  ["29285635167791094", "Arreglado (a024746). Preguntó si la antimaleza sirve como sombra y se le repitió el precio. Ahora se le explica que va en el suelo y no da sombra (por eso no lleva porcentaje) y se le nombra la Raschel."],
  ["wa:5219988441283", "Arreglado (a024746). '500 ml aprox precio' se leyó como una cantidad de 500 y luego se le ofreció UN rollo de 54 m. 'ml' ya se lee como metros lineales y un largo mayor a nuestro rollo más grande se convierte en número de rollos: 500 m son 10 rollos, o sea MAYOREO, y se canaliza con precio de referencia."],
  ["wa:5217443178473", "Arreglado (5e23003). 'Ok gracias', 'Muy amable' y 'Solo espero el buen fin' recibieron el mismo aviso cuatro veces. Un agradecimiento y un 'espero el buen fin' ahora se tratan como despedida: se responde corto y no se insiste."],
];

const PENDING = [
  ["26257152043901873", "PENDIENTE — no es del bot. El enlace malo es del 14 de junio y ese archivo ya no existe (404). Desde el 14 de septiembre el bot NO ha enviado ese enlace ni una vez (56 envíos antes, 0 después); el único posterior lo mandó una asesora, que todavía tiene guardado el PDF 2025. Faltan dos cosas, ambas de ustedes: subir el Catálogo 2026 en /company-info (hoy está cargado el LISTADO DE PRECIOS PARA DISTRIBUIDORES, que es lo que también se reportó el 27 de octubre) y pedir al equipo que reemplace su copia del PDF 2025."],
  ["wa:5213311303031", "PENDIENTE — decisión. El cliente buscaba malla de ALAMBRE (mandó un video: 'la maya donde cercan a las cabras'), que no fabricamos. El bot siguió ofreciendo malla sombra y luego pidió sus datos. Falta decidir si se agrega la regla 'malla de alambre / ciclónica / para cercar ganado = no la vendemos' con la alternativa que ofreció Noemí."],
];

(async () => {
  const write = process.argv.includes("--write");
  await mongoose.connect(process.env.MONGODB_URI);
  for (const [psid, resolution] of SOLVED) {
    const t = await Ticket.findOne({ psid, status: "open" }).sort({ createdAt: -1 });
    if (!t) { console.log(`– ${psid}: no open ticket`); continue; }
    console.log(`${write ? "✔" : "·"} SOLVED ${psid} (${t._id})`);
    if (!write) continue;
    t.status = "solved";
    t.resolution = resolution;
    t.resolvedAt = new Date();
    await t.save();
  }
  for (const [psid, resolution] of PENDING) {
    const t = await Ticket.findOne({ psid, status: "open" }).sort({ createdAt: -1 });
    if (!t) { console.log(`– ${psid}: no open ticket`); continue; }
    console.log(`${write ? "✔" : "·"} PENDING note ${psid} (${t._id})`);
    if (!write) continue;
    t.resolution = resolution; // stays OPEN on purpose
    await t.save();
  }
  await mongoose.disconnect();
  console.log(write ? "\nDone." : "\nDry run — re-run with --write to apply.");
})().catch((e) => { console.error(e); process.exit(1); });
