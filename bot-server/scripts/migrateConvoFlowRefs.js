#!/usr/bin/env node
// Migration: set convoFlowRef on ALL ads based on campaign/adSet/name context.
// Safe to run multiple times — skips ads that already have convoFlowRef.

const mongoose = require("mongoose");
require("dotenv").config();

async function migrate() {
  await mongoose.connect(process.env.MONGODB_URI);
  require("../models/Campaign");
  require("../models/AdSet");
  const Ad = require("../models/Ad");

  // ── Explicit mapping: fbAdId → convoFlowRef ──
  // Grouped by convo_flow for clarity.

  const assignments = [
    // ═══ convo_rolloRaschelWholesale ═══

    // Campaign: Rollos de Malla Sombra Marzo-Abril 2025
    { fbAdId: "120217133406130686", convoFlowRef: "convo_rolloRaschelWholesale", reason: "Rollo Raschel 90% — rollo campaign" },

    // Campaign: Rollos malla sombra JUNIO 2025
    { fbAdId: "120218222871610686", convoFlowRef: "convo_rolloRaschelWholesale", reason: "Rollos general Abril 2025" },
    { fbAdId: "120218813060130686", convoFlowRef: "convo_rolloRaschelWholesale", reason: "Monofilamento Abril 2025 — rollo campaign" },
    { fbAdId: "120224182955510686", convoFlowRef: "convo_rolloRaschelWholesale", reason: "Rollo Raschel 50% negro" },
    { fbAdId: "120224320199780686", convoFlowRef: "convo_rolloRaschelWholesale", reason: "Rollo negro 50% raschel" },
    { fbAdId: "120225301260860686", convoFlowRef: "convo_rolloRaschelWholesale", reason: "Raschel NEGRA 50 SOMBRA JUNIO" },
    { fbAdId: "120217533480170686", convoFlowRef: "convo_rolloRaschelWholesale", reason: "Raschel 90% Abril 2025" },
    { fbAdId: "120225524133040686", convoFlowRef: "convo_rolloRaschelWholesale", reason: "Carrusel de imagenes rollos" },

    // Campaign: Malla Sombra Confeccionada — but AdSet is "Rollos Malla Sombra"
    { fbAdId: "120226053092580686", convoFlowRef: "convo_rolloRaschelWholesale", reason: "Rollo Raschel 90% — in Rollos Malla Sombra adset" },

    // Campaign: Rollos Raschel
    { fbAdId: "120226935898450686", convoFlowRef: "convo_rolloRaschelWholesale", reason: "Fabrica de Rollos Hanlob" },
    { fbAdId: "120226404117730686", convoFlowRef: "convo_rolloRaschelWholesale", reason: "Raschel Beige Rollo 90%" },
    { fbAdId: "120229393318470686", convoFlowRef: "convo_rolloRaschelWholesale", reason: "Raschel 90% Fabrica Hanlob" },
    { fbAdId: "120230264972120686", convoFlowRef: "convo_rolloRaschelWholesale", reason: "Rollos 90% SOLOS" },
    { fbAdId: "120234391557720686", convoFlowRef: "convo_rolloRaschelWholesale", reason: "Buen fin rollos raschel 2025" },
    { fbAdId: "120232184315030686", convoFlowRef: "convo_rolloRaschelWholesale", reason: "Raschel 90 Oct 2025" },

    // Campaign: Rollos Raschel - ALE
    { fbAdId: "120236150814680686", convoFlowRef: "convo_rolloRaschelWholesale", reason: "Fabrica de Rollos Hanlob - ALE" },
    { fbAdId: "120236150814630686", convoFlowRef: "convo_rolloRaschelWholesale", reason: "Raschel 90% Fabrica Hanlob - ALE" },
    { fbAdId: "120236150814650686", convoFlowRef: "convo_rolloRaschelWholesale", reason: "Raschel Beige Rollo 90% - ALE" },
    { fbAdId: "120236150814660686", convoFlowRef: "convo_rolloRaschelWholesale", reason: "Rollos 90% SOLOS - ALE" },
    { fbAdId: "120236150814640686", convoFlowRef: "convo_rolloRaschelWholesale", reason: "Raschel 90 DIC 2025 - ALE" },
    { fbAdId: "120236150814620686", convoFlowRef: "convo_rolloRaschelWholesale", reason: "Buen fin rollos raschel - ALE" },

    // Campaign: Sector Agrícola - ALE
    { fbAdId: "120236149843810686", convoFlowRef: "convo_rolloRaschelWholesale", reason: "Rollos Agricolas Raschel - ALE" },
    { fbAdId: "120236149843840686", convoFlowRef: "convo_rolloRaschelWholesale", reason: "Raschel 50% sombra - ALE" },
    { fbAdId: "120236149843830686", convoFlowRef: "convo_rolloRaschelWholesale", reason: "Raschel agr 2025 - ALE" },

    // Campaign: Sector Agrícola
    { fbAdId: "120226059470470686", convoFlowRef: "convo_rolloRaschelWholesale", reason: "Raschel 50% sombra — agrícola" },
    { fbAdId: "120232184721010686", convoFlowRef: "convo_rolloRaschelWholesale", reason: "Oct raschel agr 2025" },
    { fbAdId: "120230267996300686", convoFlowRef: "convo_rolloRaschelWholesale", reason: "Rollos Agricolas Raschel" },

    // Campaign: Rollos Raschel 90%
    { fbAdId: "120237662336230686", convoFlowRef: "convo_rolloRaschelWholesale", reason: "FABRICANTES — Rollos Raschel 90%" },

    // Campaign: ROLLOS 90 27 ENERO 90%
    { fbAdId: "120237895554310686", convoFlowRef: "convo_rolloRaschelWholesale", reason: "Nuevo anuncio — ROLLOS 90 campaign" },

    // Campaign: Rollos 90% campaña de Ventas Overt
    { fbAdId: "120240431815370686", convoFlowRef: "convo_rolloRaschelWholesale", reason: "Reel Rollo 90% Sombra — Overt" },
    { fbAdId: "120240432729970686", convoFlowRef: "convo_rolloRaschelWholesale", reason: "Reel informativo Rollos 90% — Overt" },

    // Already assigned in first batch (will be skipped)
    { fbAdId: "120238479847380686", convoFlowRef: "convo_rolloRaschelWholesale", reason: "Rollos Distribuidores" },
    { fbAdId: "120238478845950686", convoFlowRef: "convo_rolloRaschelWholesale", reason: "90% Rollos" },
    { fbAdId: "120238481475310686", convoFlowRef: "convo_rolloRaschelWholesale", reason: "Rollos agricolas" },

    // ═══ convo_confeccionadaRetail ═══

    // Campaign: Malla Sombra Confeccionada Marzo - Abril 2025
    { fbAdId: "120217134940620686", convoFlowRef: "convo_confeccionadaRetail", reason: "Mallas Confeccionadas General" },

    // Campaign: Confeccionada Abril 2025 — Confeccionada adsets
    { fbAdId: "120218225444350686", convoFlowRef: "convo_confeccionadaRetail", reason: "Promo 4x4 Ref Abril 2025" },
    { fbAdId: "120218224831080686", convoFlowRef: "convo_confeccionadaRetail", reason: "Promo 4x3 Argollas Abril 2025" },
    { fbAdId: "120220741721570686", convoFlowRef: "convo_confeccionadaRetail", reason: "Reel confeccionada Abril 17 General" },
    { fbAdId: "120217413381790686", convoFlowRef: "convo_confeccionadaRetail", reason: "Promo 4x3 Ref Abril 2025" },
    { fbAdId: "120217412378750686", convoFlowRef: "convo_confeccionadaRetail", reason: "Confeccionadas Hanlob General Abril 2025" },
    { fbAdId: "120224530946460686", convoFlowRef: "convo_confeccionadaRetail", reason: "carrusel promo hotsale 2025" },
    { fbAdId: "120218801775730686", convoFlowRef: "convo_confeccionadaRetail", reason: "Promo 4x3 Arg Abril 2025" },
    { fbAdId: "120224315411610686", convoFlowRef: "convo_confeccionadaRetail", reason: "Promo 4x3 Argollas mayo-junio 2025" },
    { fbAdId: "120218806024540686", convoFlowRef: "convo_confeccionadaRetail", reason: "Promo 4x4 Ref Abril 2025 (2)" },
    { fbAdId: "120225309087470686", convoFlowRef: "convo_confeccionadaRetail", reason: "Raschel 50 sombra — Confeccionadas sitio web adset" },
    { fbAdId: "120225526437430686", convoFlowRef: "convo_confeccionadaRetail", reason: "Confeccionada malle — Confeccionada whats adset" },

    // Campaign: Malla Sombra Confeccionada
    { fbAdId: "120226050770170686", convoFlowRef: "convo_confeccionadaRetail", reason: "Confeccionada Hanlob" },
    { fbAdId: "120226051982360686", convoFlowRef: "convo_confeccionadaRetail", reason: "Confeccionada reel" },
    { fbAdId: "120234391220640686", convoFlowRef: "convo_confeccionadaRetail", reason: "Malla sombra buen fin general" },
    { fbAdId: "120234161270650686", convoFlowRef: "convo_confeccionadaRetail", reason: "Buen fin Producto solo" },
    { fbAdId: "120232182338600686", convoFlowRef: "convo_confeccionadaRetail", reason: "Confeccionada general Dic 2025" },

    // Already assigned in first batch
    { fbAdId: "120238742668510686", convoFlowRef: "convo_confeccionadaRetail", reason: "Carrusel - Copia" },

    // ═══ convo_vende_malla ═══

    // Campaign: Confeccionada Abril 2025 — Distribuidores adset
    { fbAdId: "120224174269720686", convoFlowRef: "convo_vende_malla", reason: "Venta de mala sombra — Distribuidores adset" },
    { fbAdId: "120217868898070686", convoFlowRef: "convo_vende_malla", reason: "Distribuidores Abril 2025 Overt" },
    { fbAdId: "120225518034730686", convoFlowRef: "convo_vende_malla", reason: "Distribuidores JUNIO 2025" },

    // Campaign: Distribuidores
    { fbAdId: "120226471894800686", convoFlowRef: "convo_vende_malla", reason: "Distribuidores" },

    // Campaign: Distribuidores - Ale
    { fbAdId: "120236157956340686", convoFlowRef: "convo_vende_malla", reason: "Distribuidores - Ale" },

    // Campaign: Distribuidores 2026
    { fbAdId: "120237690774230686", convoFlowRef: "convo_vende_malla", reason: "Distribuidores A 2026" },

    // Already assigned in first batch
    { fbAdId: "120240637666510686", convoFlowRef: "convo_vende_malla", reason: "reel anucnio" },

    // ═══ convo_bordeSeparadorRetail ═══

    // Campaign: Jardineria Cesar julio 2025
    { fbAdId: "120217415029330686", convoFlowRef: "convo_bordeSeparadorRetail", reason: "Cesar 2025 — Cesar borde channel" },

    // Campaign: Jardinería — ad name = Borde Separador
    { fbAdId: "120226064487050686", convoFlowRef: "convo_bordeSeparadorRetail", reason: "Borde Separador Overt" },

    // Campaign: Borde Separador
    { fbAdId: "120237463750500686", convoFlowRef: "convo_bordeSeparadorRetail", reason: "¿Buscas el acabado perfecto... — Borde campaign" },

    // Already assigned in first batch
    { fbAdId: "120229181879840686", convoFlowRef: "convo_bordeSeparadorRetail", reason: "Cesar Dic 2025" },
    { fbAdId: "120238487289160686", convoFlowRef: "convo_bordeSeparadorWholesale", reason: "Borde Separador mayoreo" },
    { fbAdId: "120238481769920686", convoFlowRef: "convo_groundcoverWholesale", reason: "Ground Cover reel (jardinería)" },

    // ═══ convo_groundcoverWholesale ═══

    // Campaign: Jardinería
    { fbAdId: "120226062091260686", convoFlowRef: "convo_groundcoverWholesale", reason: "Ground Cover 17-06-25" },

    // Campaign: Jardinería Marzo-Abril 2025
    { fbAdId: "120225531644200686", convoFlowRef: "convo_groundcoverWholesale", reason: "Reel ground cover" },

    // Campaign: Ground Cover Enero-Febrero 2026
    { fbAdId: "120237931056350686", convoFlowRef: "convo_groundcoverWholesale", reason: "reel ground cover 2026" },
  ];

  // ── SKIPPED (no specific product, master_flow handles): ──
  // 120217430318970686 - [18/03/2025] Promoción de Malla Sombra Hanlob
  // 120225113464240686 - [05/06/2025] Promoción de Malla Sombra Hanlob
  // 120231192578220686 - [16/9/2025] Promoción de Malla Sombra Hanlob
  // 120225533869780686 - Me gusta de la página ☀️...
  // 120225533296960686 - Me gusta de la página ☀️... (2)
  // 120225078353220686 - Me gusta de la página ✨...
  // 120225533089020686 - Reproducciones de video 🔥...
  // 120240477661610686 - ¿El sol no te deja disfrutar...
  // 120240648544500686 - Promoción del sitio web

  let updated = 0;
  let skipped = 0;

  for (const { fbAdId, convoFlowRef, reason } of assignments) {
    const ad = await Ad.findOne({ fbAdId });
    if (!ad) {
      console.log(`  ⚠️  Not found: ${fbAdId} (${reason})`);
      skipped++;
      continue;
    }

    if (ad.convoFlowRef) {
      console.log(`  ✓  Already set: "${ad.name}" → ${ad.convoFlowRef}`);
      skipped++;
      continue;
    }

    await Ad.updateOne({ _id: ad._id }, { $set: { convoFlowRef } });
    console.log(`  ✅ Set: "${ad.name}" → ${convoFlowRef}`);
    updated++;
  }

  console.log(`\nDone — updated: ${updated}, skipped (already set): ${skipped}`);

  // Final summary
  const total = await Ad.countDocuments();
  const withConvo = await Ad.countDocuments({ convoFlowRef: { $ne: null } });
  const without = total - withConvo;
  console.log(`\nTotal ads: ${total}`);
  console.log(`  With convoFlowRef: ${withConvo}`);
  console.log(`  Without (master_flow): ${without}`);

  await mongoose.disconnect();
}

migrate().catch(e => { console.error(e); process.exit(1); });
