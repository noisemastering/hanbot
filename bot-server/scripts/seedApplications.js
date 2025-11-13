// scripts/seedApplications.js
// Seeds the Applications tree with example data

require("dotenv").config();
const mongoose = require("mongoose");
const Application = require("../models/Application");

async function seedApplications() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB");

    // Clear existing applications
    await Application.deleteMany({});
    console.log("🗑️  Cleared existing applications");

    // Level 0: Root nodes
    const industrial = await Application.create({
      name: "Industrial",
      slug: "industrial",
      level: 0,
      order: 1,
      description: "Aplicaciones industriales y comerciales",
      icon: "🏭",
      color: "#3b82f6"
    });

    const hogar = await Application.create({
      name: "Hogar",
      slug: "hogar",
      level: 0,
      order: 2,
      description: "Aplicaciones domésticas y residenciales",
      icon: "🏠",
      color: "#10b981"
    });

    console.log("✅ Created root nodes: Industrial, Hogar");

    // Level 1: Children of Industrial
    const agricola = await Application.create({
      name: "Agrícola",
      slug: "industrial-agricola",
      parentId: industrial._id,
      level: 1,
      order: 1,
      description: "Aplicaciones para agricultura y cultivos",
      icon: "🌾"
    });

    const construccion = await Application.create({
      name: "Construcción",
      slug: "industrial-construccion",
      parentId: industrial._id,
      level: 1,
      order: 2,
      description: "Aplicaciones para construcción e infraestructura",
      icon: "🏗️"
    });

    console.log("✅ Created Industrial children: Agrícola, Construcción");

    // Level 2: Children of Agrícola
    const invernaderos = await Application.create({
      name: "Invernaderos",
      slug: "industrial-agricola-invernaderos",
      parentId: agricola._id,
      level: 2,
      order: 1,
      description: "Mallas para protección de invernaderos",
      icon: "🌱"
    });

    const antimalezaAgricola = await Application.create({
      name: "Antimaleza",
      slug: "industrial-agricola-antimaleza",
      parentId: agricola._id,
      level: 2,
      order: 2,
      description: "Control de maleza en cultivos",
      icon: "🚫🌿"
    });

    const viveros = await Application.create({
      name: "Viveros",
      slug: "industrial-agricola-viveros",
      parentId: agricola._id,
      level: 2,
      order: 3,
      description: "Protección en viveros y semilleros",
      icon: "🪴"
    });

    console.log("✅ Created Agrícola children: Invernaderos, Antimaleza, Viveros");

    // Level 2: Children of Construcción
    const andamios = await Application.create({
      name: "Andamios",
      slug: "industrial-construccion-andamios",
      parentId: construccion._id,
      level: 2,
      order: 1,
      description: "Mallas de seguridad para andamios",
      icon: "🪜"
    });

    const proteccionSolar = await Application.create({
      name: "Protección Solar",
      slug: "industrial-construccion-proteccion-solar",
      parentId: construccion._id,
      level: 2,
      order: 2,
      description: "Sombra para obras en construcción",
      icon: "☀️"
    });

    console.log("✅ Created Construcción children: Andamios, Protección Solar");

    // Level 1: Children of Hogar
    const jardin = await Application.create({
      name: "Jardín",
      slug: "hogar-jardin",
      parentId: hogar._id,
      level: 1,
      order: 1,
      description: "Aplicaciones para jardines y patios",
      icon: "🌳"
    });

    const estacionamiento = await Application.create({
      name: "Estacionamiento",
      slug: "hogar-estacionamiento",
      parentId: hogar._id,
      level: 1,
      order: 2,
      description: "Sombra para estacionamientos residenciales",
      icon: "🚗"
    });

    const terraza = await Application.create({
      name: "Terraza",
      slug: "hogar-terraza",
      parentId: hogar._id,
      level: 1,
      order: 3,
      description: "Protección para terrazas y balcones",
      icon: "🏖️"
    });

    console.log("✅ Created Hogar children: Jardín, Estacionamiento, Terraza");

    // Level 2: Children of Jardín
    const antimalezaJardin = await Application.create({
      name: "Antimaleza",
      slug: "hogar-jardin-antimaleza",
      parentId: jardin._id,
      level: 2,
      order: 1,
      description: "Control de maleza en jardines domésticos",
      icon: "🚫🌿"
    });

    const proteccionPlantas = await Application.create({
      name: "Protección de Plantas",
      slug: "hogar-jardin-proteccion-plantas",
      parentId: jardin._id,
      level: 2,
      order: 2,
      description: "Protección contra sol y heladas",
      icon: "🌺"
    });

    console.log("✅ Created Jardín children: Antimaleza, Protección de Plantas");

    console.log("\n📊 Application Tree Structure:");
    console.log("Industrial");
    console.log("  └─ Agrícola");
    console.log("      ├─ Invernaderos");
    console.log("      ├─ Antimaleza");
    console.log("      └─ Viveros");
    console.log("  └─ Construcción");
    console.log("      ├─ Andamios");
    console.log("      └─ Protección Solar");
    console.log("Hogar");
    console.log("  ├─ Jardín");
    console.log("  │   ├─ Antimaleza");
    console.log("  │   └─ Protección de Plantas");
    console.log("  ├─ Estacionamiento");
    console.log("  └─ Terraza");

    console.log("\n💡 Note: 'Antimaleza' appears in two different branches:");
    console.log("   - Industrial > Agrícola > Antimaleza");
    console.log("   - Hogar > Jardín > Antimaleza");
    console.log("   They are separate nodes but can link to the same products.");

    await mongoose.disconnect();
    console.log("\n✅ Seeding complete!");
  } catch (error) {
    console.error("❌ Seeding failed:", error);
    process.exit(1);
  }
}

seedApplications();
