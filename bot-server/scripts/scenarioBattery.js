// scripts/scenarioBattery.js
//
// Reusable SCENARIO BATTERY for the workflow engine. Unlike convoAudit (which
// grades real historical traffic), this runs a fixed set of SYNTHETIC scenarios
// through the live engine and grades each with an LLM judge — so it's repeatable
// and not dependent on real conversations.
//
// RELEVANCE-MAPPED (not a 57×flow matrix, not a blind carousel):
//   - ENGINE-shared behaviors run ONCE on a representative flow.
//   - FLOW-specific behaviors run on THEIR flow only.
// Each case is tagged with the flow it runs on, so coverage is real.
//
// Usage:
//   node scripts/scenarioBattery.js                 # run all, judge each
//   node scripts/scenarioBattery.js --flow=Coldstart
//   node scripts/scenarioBattery.js --group=coldstart
//   node scripts/scenarioBattery.js --smoke         # 1 case (harness check)
//   node scripts/scenarioBattery.js --no-judge      # run only, print transcripts
//
// Add the client's new flow by appending its cases to CASES (group: 'newflow').

const mongoose = require("mongoose");
require("dotenv").config();
const { OpenAI } = require("openai");
const WF = require("../models/Workflow");
// Register the models setupContext resolves lazily via mongoose.model(...) — without
// these the promo/preload context silently degrades (falls back to a generic line).
require("../models/ProductFamily");
require("../models/Product");
require("../models/Promo");
const { runWorkflowTurn, initState } = require("../ai/workflow");

const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });
const PROMO_6X4 = "69cdbaf4e85f61fda9122664"; // active "Promo 6x4 Beige" (reforzada ad preload)

// Flow name matchers (substring, case-insensitive) → resolved to the active doc.
const FLOWS = {
  reforzada: /con Refuerzo.*Retail/i,
  rollo: /Malla Sombra — Rollo/i,
  groundcover: /Ground Cover/i,
  sinrefuerzo: /Sin Refuerzo/i,
  borde: /Borde separador/i,
  complementos: /Complementos de Instalaci/i,
  coldstart: /Coldstart/i,
};

// ── CASES ────────────────────────────────────────────────────────────────────
// { id, group, flow, setup?, turns[], expect }  (expect = what a correct bot does)
const CASES = [
  // INFO / SERVICE Q&A ────────────────────────────────────────────────────────
  // Every case here is a question the LEGACY ai/handlers/* answered until 27305c0
  // (2026-06-15) cut the legacy tie, after which those answers were unreachable for
  // all ad and cold-start traffic. Nobody noticed for four months because all 61
  // existing scenarios test PRODUCT flows; nothing tested the Q&A that commit broke.
  // These run on cold start, which is where an unattached ad lands. If a future
  // cutover strands them again, this group fails instead of a customer reporting it.
  { id: "info-garantia", group: "info", flow: "coldstart",
    turns: ["¿Qué garantía tiene la malla?"],
    expect: "Contesta la garantía DIRECTO (1 año) y la vida útil (~5 años contra degradación solar). NO pregunta primero de qué producto se trata, ni responde vaguedades tipo 'varios años'." },
  { id: "info-durabilidad", group: "info", flow: "coldstart",
    turns: ["¿Cuánto dura la malla al sol?"],
    expect: "Da el dato concreto de vida útil (~5 años contra degradación solar), no un 'varios años' sin número." },
  { id: "info-precio-m2", group: "info", flow: "coldstart",
    turns: ["¿A cómo sale el metro cuadrado?"],
    expect: "Explica que no se vende por m² sino por pieza/medida (o por rollo) y pide la medida o el área. NO responde '¿de cuál producto me hablas?' sin explicar nada, y NO inventa un precio por m²." },
  { id: "info-area-sin-lados", group: "info", flow: "coldstart",
    turns: ["Que precio tiene el metro de la oscura", "5 metros cuadrados"],
    expect: "Pide ancho x largo (puede proponer un ejemplo que dé esa área). NUNCA cotiza un producto resuelto por coincidencia de texto, ni un rollo de borde, ni afirma un color que el cliente no pidió." },
  { id: "info-ubicacion", group: "info", flow: "coldstart",
    turns: ["¿Dónde están ubicados? ¿Hacen envíos?"],
    expect: "COMPARTE la dirección completa y el link de Google Maps en el mensaje, y confirma envíos a toda la República. NO la ofrece ('si gustas te la comparto') ni pasa con un asesor por esto." },
  { id: "info-telefono", group: "info", flow: "coldstart",
    turns: ["¿Me puedes facilitar un num para comunicarme?"],
    expect: "Comparte los teléfonos de la empresa etiquetados. NO interpreta el 'un' como una cantidad ni devuelve una cotización." },
  { id: "info-instalacion", group: "info", flow: "coldstart",
    turns: ["¿Ustedes la instalan o ponen la estructura?"],
    expect: "Aclara que no hay servicio de instalación ni estructura/postes, sin negar el producto." },
  { id: "info-factura", group: "info", flow: "coldstart",
    turns: ["¿Dan factura?"],
    expect: "Confirma que sí se factura. NO usa vocabulario interno con el cliente ('flujo', 'nodo', 'familia', 'handoff')." },
  { id: "info-contra-entrega", group: "info", flow: "coldstart",
    turns: ["¿Se puede pagar contra entrega?"],
    expect: "Explica que el pago es en línea por Mercado Libre con compra protegida y que no hay contra entrega (salvo recoger en planta)." },
  { id: "info-entrega-dias", group: "info", flow: "coldstart",
    turns: ["¿En cuántos días llega?"],
    expect: "Da un tiempo de entrega concreto (≈2 días hábiles) y aclara que varía por zona." },
  { id: "info-cp-no-tapa-pregunta", group: "info", flow: "reforzada", setup: { hasPromo: PROMO_6X4 },
    turns: ["quiero la de 6x4", "ok", "Grado de protección que ofrece y tiempo de garantía ... Gracias."],
    expect: "Responde el grado de sombra Y la garantía. NO contesta '¿a qué código postal te llegaría el pedido?' dejando las preguntas sin responder." },

  // ENGINE-SHARED (run once, on reforzada as representative) ───────────────────
  // NOTE: CP CAPTURE (both unprompted bare "77539" and "mi cp es 45100" after we
  // asked) is an OUTER-LAYER deterministic behavior — ai/index.js runEngineWorkflow:
  // captureZipReply + a ZipCode-DB validation (a bare 5-digit is treated as a CP
  // ONLY if it's a real Mexican code) + syncLocationToUser. It is NOT reachable via
  // runWorkflowTurn, so it's verified separately (ZipCode lookup tests), not by this
  // engine-level battery — where the model alone handles a lone number inconsistently.
  { id: "eng-promo-no-repitch", group: "engine", flow: "reforzada", setup: { hasPromo: PROMO_6X4 },
    turns: ["hola", "quiero la de 6x3", "excelente, gracias"],
    expect: "Tras la primera respuesta, el bot NO vuelve a re-ofrecer la promoción 6x4 en cada turno; en 'excelente' no re-pitchea la promo." },
  { id: "eng-collect-before-handoff", group: "engine", flow: "reforzada", setup: { hasPromo: PROMO_6X4 },
    turns: ["quiero precio de mayoreo, soy revendedor"],
    expect: "Escala a un asesor para mayoreo por volumen y PIDE nombre y teléfono (y cuántas piezas); NUNCA cotiza al menudeo como si fuera lo pedido." },
  { id: "eng-multimeasure-wxl", group: "engine", flow: "reforzada", setup: { hasPromo: PROMO_6X4 },
    turns: ["me cotizas 6x3 y 6x5?"],
    expect: "Cotiza AMBAS medidas con su propio precio y link. NOTA: los lados se normalizan (6x5 puede mostrarse como 5x6 — es la MISMA medida, NO cuenta como error)." },
  { id: "eng-live-ml-price", group: "engine", flow: "reforzada", setup: { hasPromo: PROMO_6X4 },
    turns: ["cuánto la de 6x4?"],
    expect: "Da un precio concreto de la 6x4 junto con su link de Mercado Libre (no se queda sin cotizar). El precio debe venir del lookup EN VIVO de ML — NO lo compares contra una cifra fija: ML cambia precios y promociones, así que basta con que haya un precio concreto y su link." },
  { id: "eng-already-bought", group: "engine", flow: "reforzada", setup: { hasPromo: PROMO_6X4 },
    turns: ["ya la compré, gracias"],
    expect: "Reconoce la compra; NO re-pitchea la promo ni re-comparte un link de compra." },
  { id: "eng-impermeable", group: "engine", flow: "reforzada", setup: { hasPromo: PROMO_6X4 },
    turns: ["esta malla me protege de la lluvia?"],
    expect: "Aclara que la malla sombra NO es impermeable / deja pasar el agua; no la vende como impermeable." },

  // REFORZADA ───────────────────────────────────────────────────────────────
  { id: "ref-non-promo-measure", group: "reforzada", flow: "reforzada", setup: { hasPromo: PROMO_6X4 },
    turns: ["quiero la de 6x3"],
    expect: "Cotiza 6x3 con SU precio/link; NO devuelve la 6x4 de la promo." },
  { id: "ref-custom-size", group: "reforzada", flow: "reforzada", setup: { hasPromo: PROMO_6X4 },
    turns: ["tienes de 1x5?"],
    expect: "Afirma que se puede sobre medida y/o ofrece la medida estándar más cercana; NUNCA niega tajante." },
  { id: "ref-oversize-closest", group: "reforzada", flow: "reforzada", setup: { hasPromo: PROMO_6X4 },
    turns: ["una de 8x10 en cuánto sale?"],
    expect: "Ofrece la medida DISPONIBLE más cercana (7x10 m) con su precio y link COMO RESPUESTA PRINCIPAL (puede además afirmar que se hace sobre medida); NUNCA escala/pasa a un asesor por el tamaño, NUNCA niega, NUNCA dice 'medida especial'." },
  { id: "ref-decimal-ceil", group: "reforzada", flow: "reforzada", setup: { hasPromo: PROMO_6X4 },
    turns: ["quiero 4.5 x 4.5"],
    expect: "Redondea HACIA ARRIBA a la medida disponible (5x5 m) y la cotiza con precio+link; NUNCA la niega ni dice 'no manejamos decimales' ni hace handoff." },
  { id: "ref-color", group: "reforzada", flow: "reforzada", setup: { hasPromo: PROMO_6X4 },
    turns: ["la tienes en negro?"],
    expect: "El cliente pide un color específico (negro): lo OFRECE con su precio y su link propio (negro y verde SÍ están en stock). NUNCA responde 'solo beige' ni escala a un asesor por un color que está en stock." },
  { id: "ref-color-first-msg", group: "reforzada", flow: "reforzada", setup: { hasPromo: PROMO_6X4 },
    turns: ["la tienes en color verde"],
    expect: "AUNQUE sea el PRIMER mensaje (sin haber cotizado antes), reconoce el VERDE y lo cotiza; nunca dice 'solo beige'. Si ese color tiene publicación activa en ML, da precio Y link sin escalar. Si NO la tiene (hoy la publicación de Verde 6x4 responde 404), lo correcto es dar el precio y pasar con un asesor: nunca dejar un precio sin forma de comprarlo ni inventar un link." },
  { id: "ref-quantity-retail", group: "reforzada", flow: "reforzada", setup: { hasPromo: PROMO_6X4 },
    turns: ["quiero 3 piezas de 6x4"],
    expect: "3 piezas está por DEBAJO del mínimo de mayoreo (5 para 6x4) → es MENUDEO: cotiza el precio por pieza con su link; NO lo trata como mayoreo." },
  { id: "ref-quantity-wholesale", group: "reforzada", flow: "reforzada", setup: { hasPromo: PROMO_6X4 },
    turns: ["quiero 6 piezas de 6x4"],
    expect: "6 piezas alcanza el mínimo de mayoreo (5 para 6x4) → reconoce que es MAYOREO/volumen y pide NOMBRE, TELÉFONO y CÓDIGO POSTAL para pasar con un asesor (los tres son obligatorios al canalizar). Debe nombrar la medida como la escribió el cliente (6x4, no 4x6)." },
  // Reported (psid 28337932562560404): two questions in one message, both dropped and
  // replaced by the postal-code ask. "Grado de protección" was not stated in ANY flow's
  // knowledge or prompt, so there was nothing to answer with.
  { id: "ref-proteccion-y-garantia", group: "reforzada", flow: "reforzada", setup: { hasPromo: PROMO_6X4 },
    turns: ["Grado de protección que ofrece y tiempo de garantía ... Gracias."],
    expect: "Contesta LAS DOS cosas en el mismo mensaje: el grado de protección con su número (la confeccionada es 90% de sombra) Y la garantía/vida útil. NO pregunta '¿de qué producto?', NO pide el código postal en lugar de contestar, y NO pasa con un asesor." },
  { id: "ref-measure-label", group: "reforzada", flow: "reforzada", setup: { hasPromo: PROMO_6X4 },
    turns: ["cuánto la de 8x4?"],
    expect: "Cotiza la medida 8x4 (= 4x8 m, sí existe en catálogo) con un precio concreto y su link. NO compares el precio contra una cifra fija: ML cambia precios y promociones. Lo que se evalúa es la MEDIDA, que debe decirse 8x4 o 4x8 (mismo producto), preferentemente en el orden en que la escribió el cliente — NUNCA otra como 7x4 (fue un bug real reportado por el cliente)." },

  // ROLLO ─────────────────────────────────────────────────────────────────────
  { id: "rollo-ask-length-area", group: "rollo", flow: "rollo",
    turns: ["me interesa la malla en rollo"],
    expect: "Pregunta qué LARGO necesita o qué ÁREA cubrir; NO enumera todas las medidas ni da un rango sin sentido." },
  { id: "rollo-exact-ask-qty", group: "rollo", flow: "rollo",
    turns: ["quiero 90% de 4x50"],
    expect: "Identifica el rollo 90% 4x50 y pregunta SOLO la cantidad (cuántos rollos)." },
  { id: "rollo-qty-2plus", group: "rollo", flow: "rollo",
    turns: ["quiero 90% de 4x50", "necesito 3"],
    expect: "3 rollos = MAYOREO → pasa con un especialista." },
  { id: "rollo-unavailable-shade", group: "rollo", flow: "rollo",
    turns: ["tienes rollos de 75%?"],
    expect: "No manejamos 75% → lo dice y lo pasa con un especialista, preguntando a qué le quiere dar sombra." },
  { id: "rollo-nonexact-area", group: "rollo", flow: "rollo",
    turns: ["tienes rollo de 5x20 en 90%?", "sí, correcto"],
    expect: "Confirma el área (~100 m²) y recomienda un rollo real cuya ÁREA se acerque a 100 m² (p. ej. 2x50 = 100 m² es CORRECTO), con precio + link." },
  { id: "rollo-no-confeccionada-switch", group: "rollo", flow: "rollo",
    turns: ["quiero 90% de 2x10"],
    expect: "Cotiza el ROLLO 2x10; NO cambia a confeccionada ni pregunta '¿reforzada o rollo?'." },

  // GROUND COVER ──────────────────────────────────────────────────────────────
  { id: "gc-ask-length-no-shade", group: "groundcover", flow: "groundcover",
    turns: ["me interesa ground cover"],
    expect: "Pregunta largo o área; NUNCA pregunta por % de sombra (ground cover no tiene)." },
  { id: "gc-exact-qty", group: "groundcover", flow: "groundcover",
    turns: ["quiero ground cover de 4x100", "1"],
    expect: "4x100 m es ROLLO COMPLETO (regla 2026-10-23): cotiza el precio de lista con IVA incluido ($4,222.40), NO comparte link de Mercado Libre y pasa la venta con un asesor para el envío. Compartir un link aquí es el error." },
  { id: "gc-alias-antimaleza", group: "groundcover", flow: "groundcover",
    turns: ["tienen malla antimaleza?"],
    expect: "Reconoce 'antimaleza' como ground cover y ayuda; no dice que no lo manejan." },
  { id: "gc-no-confeccionada-switch", group: "groundcover", flow: "groundcover",
    turns: ["tienes de 4x10?"],
    expect: "Trata 4x10 como ground cover (confirma área o cotiza); NO cambia a malla sombra confeccionada." },
  // Reported 2026-10-23: un humano tuvo que escribir el catálogo a mano porque el bot
  // contestó estas tres con una pregunta abierta de medida.
  { id: "gc-medidas-disponibles", group: "groundcover", flow: "groundcover",
    turns: ["¿Qué medidas están disponibles?"],
    expect: "LISTA las medidas que existen (anchos de 2 y 4 m con sus largos) con precios; NO responde con una pregunta abierta tipo '¿qué largo necesitas o qué área quieres cubrir?' sin dar antes las opciones." },
  // Expectation tightened 2026-10-23 (client's rule): a bare PRICE ask must come back with
  // NUMBERS, not a size range the customer has to pick from first. The full rolls are only
  // two, so both get quoted. The old wording ("ofrece las medidas con precios") also passed
  // for the size-range answer that made Noemi step in on psid 28529106973427095.
  { id: "gc-precio-sin-medida", group: "groundcover", flow: "groundcover",
    turns: ["¿Cuál es el precio?"],
    expect: "Cotiza LOS DOS rollos completos con su precio exacto (2x100 m y 4x100 m), con IVA incluido y SIN link de Mercado Libre, y pasa con un asesor para el envío (regla ROLLO COMPLETO 2026-10-23). NO responde con un rango 'desde X hasta Y' ni con una pregunta abierta de medida. Puede mencionar en una frase que hay cortes más chicos." },
  // The client's rule, 2026-10-23: "if prices differ we ask them but if they don't we
  // share the price". Asking is only pointless when the answer cannot move the number.
  { id: "gc-color-mismo-precio", group: "groundcover", flow: "groundcover",
    turns: ["quiero 4x100"],
    expect: "Da el precio del rollo completo (IVA incluido, sin link, con asesor) Y dice que negro y blanco cuestan lo mismo. NO pregunta el color antes de dar el precio: en esta medida el color no cambia el precio." },
  { id: "gc-color-precio-distinto", group: "groundcover", flow: "groundcover",
    turns: ["quiero 2x50", "negro"],
    expect: "En 2x50 m el precio SÍ cambia por color, así que el primer turno PREGUNTA el color (negro o blanco) sin inventar un precio ni cotizar solo uno de los dos; el segundo turno, ya con el color elegido, cotiza ESE color con su precio y su propio link." },
  { id: "gc-precio-rollos", group: "groundcover", flow: "groundcover",
    turns: ["¿Qué precio tienen los rollos?"],
    expect: "Igual que gc-precio-sin-medida: es una pregunta de PRECIO, no de medidas, aunque diga 'rollos'. Cotiza los dos rollos completos con su precio exacto, sin link, con asesor. NO debe contestar con la lista/rango de medidas." },
  { id: "gc-area-sin-lados", group: "groundcover", flow: "groundcover",
    turns: ["Necesito cubrir 200 m2"],
    expect: "Recomienda un rollo real que cubra esa área (p.ej. 2x100 o 4x50 m) con su precio; NO pide que el cliente convierta el área a ancho x largo. Si el rollo recomendado es COMPLETO (100 m), va sin link y con asesor (regla 2026-10-23); si es una pieza cortada (4x50), sí lleva link." },

  { id: "gc-medida-de-confeccionada", group: "groundcover", flow: "groundcover",
    turns: ["Requiero la siguiente medida. 3 × 4. En cuanto sale ?"],
    expect: "3x4 m no es ningún rollo de ground cover (los rollos van de 10 a 100 m de largo), es una malla sombra CONFECCIONADA: debe cambiar de flujo y cotizar la de 4x3 m con su precio y su link. NO debe convertirla en '¿el área que buscas cubrir es de 12 m²?' ni acabar cotizando un rollo de 2x100 que el cliente nunca pidió (reportado 2026-10-24, psid 29364210186519165)." },
  { id: "gc-color-que-no-existe", group: "groundcover", flow: "groundcover",
    turns: ["¿la tienen en beige?"],
    expect: "Dice que el ground cover va en negro y blanco Y le ofrece una salida: que la malla sombra sí viene en beige y se la cotiza si da la medida. NO debe terminar en 'solo manejamos negro y blanco' sin ofrecer nada, ni ofrecer beige en ground cover (no existe)." },

  // BORDE ─────────────────────────────────────────────────────────────────────
  { id: "borde-medida-mas-cp", group: "borde", flow: "borde",
    turns: ["¿Cuánto cuesta el Borde Separador Grueso Hanlob?", "18 mts. C P 92730"],
    expect: "El segundo mensaje trae DOS datos: la medida elegida (18 m) y el código postal. Debe COTIZAR los 18 m — no basta con 'ya registré tu código postal', y nunca debe volver a listar los cuatro largos como si el cliente no hubiera escogido (reportado 2026-10-24, psid 30117186911215086). Registrar el CP además está bien." },
  { id: "borde-sin-medida-inventada", group: "borde", flow: "borde",
    turns: ["¿Cuánto cuesta el rollo de 18 m?"],
    expect: "Lo ÚNICO que se evalúa es cómo NOMBRA la medida: NUNCA debe escribir '13x18m' ni '13 x 18' ni ninguna medida de dos lados, porque el borde se vende por LARGO y el 13 es la altura en centímetros — '13x18 m' se lee como un rollo de 13 por 18 metros, que no existe. Cualquier respuesta que hable del rollo de 18 m sin esa cadena APRUEBA, incluida la de cotizar directamente el rollo grueso de 18 m, que es la respuesta normal y correcta en este largo." },
  { id: "borde-por-rollo", group: "borde", flow: "borde",
    turns: ["el borde se vende por rollo?"],
    expect: "Confirma que sí se vende por rollo/largo y menciona los largos disponibles (6, 9, 18, 54 m); no escala lo que puede contestar. Compartir los precios de una vez es CORRECTO y deseable (la campaña pide comunicar precios de forma proactiva desde las primeras interacciones), no cuenta como información de más." },
  { id: "borde-single", group: "borde", flow: "borde",
    turns: ["precio del borde de 18 m"],
    expect: "Cotiza el rollo de 18 m con el precio del GRUESO ($709) y sigue hacia la cantidad; nombrar la versión ('grueso', 'Premium') es OPCIONAL y su ausencia no es un error. PROHIBIDO mencionar o cotizar la versión Flexible/delgada: su precio solo se comparte si el cliente pide algo más económico o la nombra él mismo. Tampoco debe preguntar la medida otra vez." },
  { id: "borde-qty-one", group: "borde", flow: "borde",
    turns: ["precio del borde", "de 18", "uno"],
    expect: "Flujo: menú con los precios del grueso → elige 18 m → dice 'uno' (cantidad, no versión ni largo). Con 1 pieza es venta individual, así que cotiza el rollo de 18 m con su precio Y su link de compra. No debe pedir la medida ni la cantidad otra vez, ni leer el 'uno' como un largo." },
  { id: "borde-qty-mayoreo", group: "borde", flow: "borde",
    turns: ["precio del borde", "de 54", "dos"],
    expect: "Al pedir 2 rollos lo trata como MAYOREO y pasa con un especialista (no comparte link de menudeo)." },
  { id: "borde-multi-length", group: "borde", flow: "borde",
    turns: ["precio del borde de 9 y 18 m"],
    expect: "Cotiza AMBOS largos (9 m y 18 m), cada uno con su precio y link." },
  { id: "borde-delgado", group: "borde", flow: "borde",
    turns: ["quiero el borde delgado de 18 m"],
    expect: "Reconoce la variante delgada de 18 m (NO la gruesa) y da SU precio. Nombrarla 'Flexible' es CORRECTO: Premium = grueso 3 mm y Flexible = delgado 1.5 mm es la nomenclatura del cliente. Luego pregunta cuántos rollos antes de compartir el link." },
  { id: "borde-closest", group: "borde", flow: "borde",
    turns: ["quiero 57 metros de borde"],
    expect: "Ofrece el largo disponible más cercano (54 m); no niega ni inventa." },
  { id: "borde-switch-antimaleza", group: "borde", flow: "borde",
    turns: ["precio de la malla antimaleza"],
    expect: "Reconoce que antimaleza es GROUND COVER (otro flujo) y ayuda con ese producto (pregunta largo/área o cotiza); NUNCA responde con el borde separador ni '¿qué largo?' de borde." },
  { id: "borde-switch-malla-rollo", group: "borde", flow: "borde",
    turns: ["quiero malla sombra en rollo de 4.2 x 100 al 35%"],
    expect: "Cambia al flujo de MALLA SOMBRA ROLLO y cotiza/ayuda con ese rollo; NUNCA lo trata como borde separador." },
  // CANTIDAD + PRESENTACIÓN EN UN SOLO MENSAJE. Ningún gate cubría esta forma, así que
  // el modelo contestaba: vendió 3 piezas de 18 m y 2 rollos de 54 m con link (son
  // mayoreo según §2.B/§3.2/§5) y cotizó el grueso a quien pidió el delgado.
  { id: "borde-order-mayoreo-18", group: "borde", flow: "borde",
    turns: ["Quiero 3 piezas de 18 metros premium"],
    expect: "3 piezas de 18 m es MAYOREO: da el precio de referencia (unitario y total) y pide nombre, teléfono y código postal para un asesor. NO debe compartir link de compra ni cerrar la venta en línea." },
  { id: "borde-order-mayoreo-54", group: "borde", flow: "borde",
    turns: ["Necesito 2 rollos de 54 metros delgado"],
    expect: "Más de un rollo de 54 m es MAYOREO: precio de referencia del Flexible (delgado) + canalización con asesor. NO link de compra." },
  { id: "borde-order-retail", group: "borde", flow: "borde",
    turns: ["Quiero 2 rollos de 18 metros premium"],
    expect: "2 piezas de 18 m es compra INDIVIDUAL: precio unitario, total por los 2 y el link de compra con envío gratis. NO lo manda con un asesor." },
  { id: "borde-order-mixed", group: "borde", flow: "borde",
    turns: ["Buen día, quiero 20 metros", "¿Puede ser entonces uno de 6 y uno de 18?"],
    expect: "Es el flujo 1 del documento del cliente: 20 m → ofrece la presentación más cercana (18 m); luego 1 de 6 + 1 de 18 es compra INDIVIDUAL (una pieza de cada una), así que comparte el precio del grueso Y el link de CADA presentación sin preguntar la versión. NUNCA debe leerlo como '6 rollos de 18' ni mandarlo a mayoreo." },
  // EL PRECIO QUE OFRECEMOS ES EL DEL GRUESO. El menú de dos columnas contestaba
  // "Precio por favor" con una comparativa contra nosotros mismos (reportado
  // 2026-10-26, Alejandra Mora): el Flexible es hasta $350 más barato y el cliente
  // se quedó en "no lo sé". El delgado solo sale si lo piden.
  { id: "borde-grueso-primero", group: "borde", flow: "borde",
    turns: ["Precio por favor", "¿no tienes algo más barato?"],
    expect: "Primer mensaje: los cuatro largos (6, 9, 18, 54 m) con el precio del GRUESO únicamente — PROHIBIDO nombrar, insinuar o cotizar la versión Flexible/delgada. Segundo mensaje: ahí SÍ debe revelar el Flexible (delgado, 1.5 mm) con sus precios, porque el cliente pidió algo más económico." },
  { id: "borde-version-comparativa", group: "borde", flow: "borde",
    turns: ["El de 54", "Y en verdad está mejor el premium", "Que el flexible"],
    expect: "El cliente ELIGE Premium y descarta Flexible. Debe cotizar el PREMIUM de 54 m. Cotizar el Flexible es un error (nombrar las dos versiones en un mensaje no significa que quiera la segunda)." },
  { id: "borde-sin-publicacion", group: "borde", flow: "borde",
    turns: ["Quiero 2 piezas de 9 metros flexible"],
    expect: "El Flexible de 9 m no tiene publicación activa: debe cotizar el precio del FLEXIBLE y canalizar con un asesor. Es un error cotizar el precio del Premium/grueso o mandar el link del grueso." },
  { id: "borde-ubicacion-con-cantidad", group: "borde", flow: "borde",
    turns: ["El de 54", "Flexible", "Solo ocupo uno!!\n¿Dónde están ubicados?"],
    expect: "Contesta LAS DOS cosas: cierra el rollo Flexible de 54 m (precio; es ROLLO COMPLETO, así que va sin link y con asesor — regla 2026-10-23) Y comparte la dirección. Ignorar la pregunta de ubicación es el error reportado." },
  { id: "borde-mayoreo-envio", group: "borde", flow: "borde",
    turns: ["Precio de mayoreo del borde grueso", "50 rollos de 18", "¿Cuánto cuesta el envío a Monterrey?"],
    expect: "§3.5: a un cliente de MAYOREO no se le dice que el envío es gratis por Mercado Libre. Debe explicar que el flete se cotiza por volumen/destino y pedir código postal y datos de contacto. En el turno de las 50 piezas debe dar el precio de referencia, no sólo 'gracias'." },

  // SIN REFUERZO ──────────────────────────────────────────────────────────────
  { id: "sin-beige-only", group: "sinrefuerzo", flow: "sinrefuerzo",
    turns: ["la de argollas de 3x3 en negro"],
    expect: "Aclara que sin refuerzo (con argollas) es SOLO beige; no ofrece negro." },
  { id: "sin-in-catalog", group: "sinrefuerzo", flow: "sinrefuerzo",
    turns: ["precio de la de argollas 3x3"],
    expect: "Cotiza la 3x3 CON ARGOLLAS en beige con precio/link. NOTA: 'con argollas' = 'sin refuerzo' (es el MISMO producto); cotizar 'la de argollas' es CORRECTO." },
  { id: "sin-missing-mention-reforzada", group: "sinrefuerzo", flow: "sinrefuerzo",
    turns: ["tienes con argollas de 7x10?"],
    expect: "Esa medida no está en sin refuerzo → MENCIONA que en REFORZADA sí, con su precio+link; NO cambia de flujo." },

  // COMPLEMENTOS DE INSTALACIÓN ────────────────────────────────────────────────
  // Named SKUs (kit / cordón / ojillos packets), resolved deterministically; the
  // net→complement map: confeccionada→kit+cordón, rollo/GC→ojillos+cordón.
  { id: "comp-kit-direct", group: "complementos", flow: "complementos",
    turns: ["cuánto cuesta el kit de instalación?"],
    expect: "Cotiza el kit de instalación con un precio en vivo y su link de compra; NUNCA dice que no tiene el precio ni pide una medida." },
  { id: "comp-cordon", group: "complementos", flow: "complementos",
    turns: ["me das precio del cordón con protección uv?"],
    expect: "Cotiza el cordón/lazo con protección UV (rollo de 47 m) con precio + link." },
  { id: "comp-ojillos-count", group: "complementos", flow: "complementos",
    turns: ["necesito como 45 ojillos sujetadores, precio?"],
    expect: "Para 45 ojillos ofrece el PAQUETE inmediato superior (50 piezas) con precio + link; no inventa ni pide una medida." },
  { id: "comp-ojillos-askqty", group: "complementos", flow: "complementos",
    turns: ["quiero ojillos sujetadores", "como 80"],
    expect: "Primero pregunta cuántas piezas necesita (paquetes 10–100); con 80 cotiza el paquete de 100 con precio + link." },
  { id: "comp-net-confeccionada", group: "complementos", flow: "complementos",
    turns: ["tengo malla confeccionada, qué necesito para instalarla?"],
    expect: "Recomienda el KIT de instalación + el CORDÓN UV (no ojillos); puede ofrecer cotizar alguno." },
  { id: "comp-net-rollo", group: "complementos", flow: "complementos",
    turns: ["tengo un rollo de malla sombra, con qué lo monto?"],
    expect: "Recomienda los OJILLOS SUJETADORES + el CORDÓN UV (no el kit)." },

  // ── COLD-START (special focus — biggest concern) ─────────────────────────────
  // Reported (psid 29182652441424827): "el metro de la oscura" + "5 metros cuadrados" was
  // answered with a Borde Separador "Rollo de 54 m" in BEIGE at $1,599, buy link attached —
  // a 54-metre edging strip sold for 5 m² of shade cloth, in the lightest colour available,
  // to someone who had asked for the dark one.
  { id: "cs-oscura-area", group: "coldstart", flow: "coldstart",
    turns: ["Que presio tiene el metro de la oscura", "5 metros cuadrados"],
    expect: "Reconoce que 'la oscura' pide un COLOR oscuro (negro o verde) y nunca contesta con beige. Un ÁREA (5 m²) es una superficie, así que pide el ancho x largo para cubrirla o recomienda una medida real de MALLA SOMBRA; JAMÁS cotiza un borde separador, una cinta ni un rollo de 54 m, que se venden por metro lineal." },
  // Reported twice (psids 28529106973427095 and 29319361417751588): "¿Cuál es el precio
  // de la malla?" / "¿Cuál es el precio?" were answered with no number at all — "dime el
  // ancho y el largo" — and in both cases the asesor then had to quote by hand. The
  // client's call: answer with real "desde" anchors and THEN ask the measure.
  { id: "cs-bare-price-ask", group: "coldstart", flow: "coldstart",
    turns: ["¿Cuál es el precio de la malla?"],
    expect: "Debe dar PRECIOS REALES como ancla (al menos dos: confeccionada 'desde $…', borde separador 'desde $…', rollo de antimaleza/ground cover 2x100 m) y luego preguntar cuál producto y qué medida. NO aprueba una respuesta que sólo pida la medida sin ningún precio, ni una que liste porcentajes de sombra (35/50/70/80/90% es de los ROLLOS; la confeccionada es siempre 90%), ni una que vuelque el catálogo." },
  { id: "cs-bare-measure", group: "coldstart", flow: "coldstart",
    turns: ["precio de 3x3"],
    expect: "Una medida 2-D pelona (3x3) debe enrutar a MALLA CONFECCIONADA (reforzada, el default) y cotizar 3x3; NUNCA tratarla como borde/rollo 1-D, ni quedarse mudo." },
  { id: "cs-100m-to-rollo", group: "coldstart", flow: "coldstart",
    turns: ["quiero malla de 4x100"],
    expect: "4x100 existe en ROLLO y en GROUND COVER → enruta a uno de ellos, o aclara entre rollo y ground cover; NUNCA confeccionada/reforzada/borde. (Aclarar entre rollo y GC es válido.)" },
  { id: "cs-confeccionada", group: "coldstart", flow: "coldstart",
    turns: ["malla sombra confeccionada de 4x6"],
    expect: "Enruta a malla sombra confeccionada (reforzada)." },
  { id: "cs-ground-cover", group: "coldstart", flow: "coldstart",
    turns: ["tienen ground cover?"],
    expect: "Reconoce ground cover y enruta a su flujo; no lo confunde con malla sombra." },
  { id: "cs-antimaleza", group: "coldstart", flow: "coldstart",
    turns: ["busco malla antimaleza para el suelo"],
    expect: "Reconoce 'antimaleza' = ground cover y enruta allí." },
  { id: "cs-borde", group: "coldstart", flow: "coldstart",
    turns: ["necesito borde separador para jardín"],
    expect: "Enruta al flujo de borde separador." },
  { id: "cs-argollas", group: "coldstart", flow: "coldstart",
    turns: ["quiero la malla con argollas, sin refuerzo"],
    expect: "Enruta a sin refuerzo (con argollas)." },
  { id: "cs-rain", group: "coldstart", flow: "coldstart",
    turns: ["necesito algo para que no entre la lluvia al patio"],
    expect: "Aclara que la malla sombra NO es impermeable; no la vende como protección de lluvia. Ofrece lo que sí aplica o asesor." },
  { id: "cs-greeting-only", group: "coldstart", flow: "coldstart",
    turns: ["hola, buenas"],
    expect: "Saluda e identifica qué producto/medida busca; NO vuelca una lista larga de medidas ni inventa." },
  { id: "cs-out-of-realm", group: "coldstart", flow: "coldstart",
    turns: ["venden tinacos?"],
    expect: "Aclara con naturalidad que no manejamos ese producto; no inventa ni cotiza algo que no vendemos." },
  { id: "cs-measure-plus-product", group: "coldstart", flow: "coldstart",
    turns: ["un rollo de 2x100 de malla sombra"],
    expect: "Enruta a ROLLO con esa medida." },
  { id: "cs-malla-6x4", group: "coldstart", flow: "coldstart",
    turns: ["dame el precio de la malla 6x4"],
    expect: "Enruta a malla confeccionada (reforzada) y cotiza 6x4 con su precio LIVE de ML + link; el precio sale del flujo correcto, no inventado." },
  { id: "cs-worded-measure", group: "coldstart", flow: "coldstart",
    turns: ["precio de tres por tres"],
    expect: "Interpreta 'tres por tres' = 3x3 igual que con dígitos y enruta a confeccionada (reforzada) cotizando 3x3; no se confunde por estar escrito con palabras." },
  { id: "cs-multiple-products", group: "coldstart", flow: "coldstart",
    turns: ["ocupo malla sombra y también ground cover"],
    expect: "Maneja que mencionó dos productos: pregunta cuál atender primero o los distingue; no mezcla ni ignora uno." },
  { id: "cs-location-question", group: "coldstart", flow: "coldstart",
    turns: ["¿hacen envíos a Monterrey?"],
    expect: "Responde sobre envío/cobertura y reencauza hacia qué producto/medida busca; no se queda sin enrutar." },
  { id: "cs-vague-interest", group: "coldstart", flow: "coldstart",
    turns: ["vi su anuncio, me interesa"],
    expect: "Pregunta qué producto/medida busca para enrutar; no asume ni cotiza a ciegas." },
  { id: "cs-complement-ojillos", group: "coldstart", flow: "coldstart",
    turns: ["venden ojillos sujetadores?"],
    expect: "Reconoce que SÍ los vendemos y los atiende (el cambio de flujo es transparente: una respuesta que pregunta por cuántas piezas o que cotiza el paquete YA es la atención correcta del flujo de Complementos); NUNCA niega el producto." },
  { id: "cs-complement-kit", group: "coldstart", flow: "coldstart",
    turns: ["tienen kit de instalación?"],
    expect: "Reconoce el kit y lo atiende/cotiza (el cambio de flujo es transparente: dar el precio + link del kit YA es la atención correcta del flujo de Complementos); NUNCA niega el producto." },
];

function flowDoc(cache, key) { return cache[key]; }

async function runCase(c, flowsCache) {
  const wf = flowsCache[c.flow];
  if (!wf) return { id: c.id, error: `flow '${c.flow}' not found/active` };
  let state = initState(wf);
  state.workflowId = String(wf._id);
  if (c.setup) state.setupOverrides = { ...(state.setupOverrides || {}), ...c.setup };
  const transcript = [];
  for (const msg of c.turns) {
    let out;
    try { out = await runWorkflowTurn(wf, state, msg, { psid: `BAT-${c.id}`, sandbox: true }); }
    catch (e) { return { id: c.id, group: c.group, flow: c.flow, error: e.message, transcript }; }
    state = out.state;
    const d = out.diagnostics || {};
    const sw = typeof d.switchedTo === "object" && d.switchedTo
      ? (d.switchedTo.name || d.switchedTo.workflowId || d.switchedTo.id || "?")
      : (d.switchedTo || "?");
    const tag = d.measureAutoSwitch ? `→switch:${sw}` : d.measureClarify ? "→clarify" : d.handoffRequested ? "→handoff" : "";
    transcript.push({ user: msg, bot: (out.reply || out.text || "(sin respuesta)").trim(), tag });
  }
  return { id: c.id, group: c.group, flow: c.flow, transcript, expect: c.expect };
}

async function judge(c, r) {
  const convo = r.transcript.map((t) => `CLIENTE: ${t.user}\nBOT: ${t.bot}${t.tag ? ` [${t.tag}]` : ""}`).join("\n");
  const res = await openai.chat.completions.create({
    model: "gpt-4o", temperature: 0, max_tokens: 120, response_format: { type: "json_object" },
    messages: [
      { role: "system", content: `Eres QA del bot de ventas Hanlob (malla sombra), español mexicano. Te doy una conversación de prueba y el COMPORTAMIENTO ESPERADO. Decide si el bot lo cumplió. Sé estricto pero justo: respuestas breves o pedir un dato faltante NO son error si cumplen lo esperado. Devuelve SOLO JSON {"pass": true|false, "reason": "<breve>"}.` },
      { role: "user", content: `ESPERADO: ${r.expect}\n\nCONVERSACIÓN:\n${convo}` },
    ],
  });
  try { return JSON.parse(res.choices[0].message.content); } catch { return { pass: null, reason: "judge parse error" }; }
}

(async () => {
  const args = process.argv.slice(2);
  const smoke = args.includes("--smoke");
  const noJudge = args.includes("--no-judge");
  const flowArg = (args.find((a) => a.startsWith("--flow=")) || "").split("=")[1];
  const groupArg = (args.find((a) => a.startsWith("--group=")) || "").split("=")[1];

  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const flowsCache = {};
  for (const [k, re] of Object.entries(FLOWS)) flowsCache[k] = await WF.findOne({ name: re, active: true });

  let cases = CASES;
  if (flowArg) cases = cases.filter((c) => c.flow.toLowerCase() === flowArg.toLowerCase());
  if (groupArg) cases = cases.filter((c) => c.group.toLowerCase() === groupArg.toLowerCase());
  if (smoke) cases = cases.filter((c) => c.group === "coldstart").slice(0, 1);

  console.log(`\n════════ SCENARIO BATTERY — ${cases.length} cases${smoke ? " (SMOKE)" : ""} ════════`);
  const byGroup = {};
  let pass = 0, fail = 0, err = 0;
  for (const c of cases) {
    const r = await runCase(c, flowsCache);
    if (r.error) { err++; console.log(`\n❌ [${c.group}/${c.id}] ERROR: ${r.error}`); continue; }
    let verdict = { pass: null, reason: "(judge skipped)" };
    if (!noJudge) verdict = await judge(c, r);
    (byGroup[c.group] = byGroup[c.group] || { p: 0, f: 0 });
    if (verdict.pass === true) { pass++; byGroup[c.group].p++; }
    else if (verdict.pass === false) { fail++; byGroup[c.group].f++; }
    const mark = verdict.pass === true ? "✅" : verdict.pass === false ? "❌" : "•";
    console.log(`\n${mark} [${c.group}/${c.id}] (${c.flow})`);
    // Print enough to judge a failure by eye. The judge always gets the FULL reply
    // (see judge()), but at 160 chars the console cut the borde menu off at "18 m",
    // which reads exactly like the bot never mentioned the 54 m roll — and sent me
    // looking for a harness bug that wasn't there.
    for (const t of r.transcript) console.log(`   👤 ${t.user}\n   🤖 ${t.bot.length > 700 ? t.bot.slice(0, 700) + " …[recortado para la consola; el juez recibió el texto completo]" : t.bot}${t.tag ? `  [${t.tag}]` : ""}`);
    if (!noJudge) console.log(`   ⇒ ${verdict.pass ? "PASS" : "FAIL"}: ${verdict.reason}`);
  }
  if (!noJudge) {
    console.log(`\n════════ RESULT: ${pass} pass / ${fail} fail / ${err} err (of ${cases.length}) ════════`);
    console.log(Object.entries(byGroup).map(([g, v]) => `  ${g}: ${v.p}/${v.p + v.f}`).join("\n"));
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
