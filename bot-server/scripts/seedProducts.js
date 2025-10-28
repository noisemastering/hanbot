require("dotenv").config({ path: "../.env" });
const mongoose = require("mongoose");
const Product = require("../models/Product");
const ProductFamily = require("../models/ProductFamily");
const ProductSubfamily = require("../models/ProductSubfamily");

const MONGO_URI = process.env.MONGODB_URI;
console.log("🔍 MONGODB_URI:", process.env.MONGODB_URI);

async function seed() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ Conectado a MongoDB");

    // Limpia las colecciones (solo para desarrollo)
    await Promise.all([
      Product.deleteMany({}),
      ProductFamily.deleteMany({}),
      ProductSubfamily.deleteMany({}),
    ]);

    // 1️⃣ Familias
    const familyMalla = await ProductFamily.create({
      name: "Malla sombra",
      description: "Malla sombra para jardín e invernadero, disponible en diferentes colores y resistencias."
    });

    const familyBorde = await ProductFamily.create({
      name: "Borde",
      description: "Bordes plásticos para jardín o huertos, disponibles próximamente.",
      active: true
    });

    console.log("🌿 Familias creadas:", familyMalla.name, ",", familyBorde.name);

    // 2️⃣ Subfamilias (solo para malla sombra)
    const subBeige = await ProductSubfamily.create({
      familyId: familyMalla._id,
      name: "Beige",
      aliases: ["beige", "malla sombra beige"],
      description: "Malla sombra beige del 90%, ideal para jardín e invernadero.",
      available: true
    });

    const subMono = await ProductSubfamily.create({
      familyId: familyMalla._id,
      name: "Monofilamento",
      aliases: ["negra", "malla sombra negra", "monofilamento"],
      description: "Malla sombra monofilamento negra, más resistente y duradera.",
      available: true
    });

    console.log("🌈 Subfamilias creadas:", subBeige.name, ",", subMono.name);

    // 3️⃣ Productos (solo en subfamilia Beige)
    const products = [
      {
        familyId: familyMalla._id,
        subfamilyId: subBeige._id,
        name: "Malla sombra beige 90% 3x4m",
        type: "confeccionada",
        size: "3x4m",
        price: "450",
        mLink: "https://articulo.mercadolibre.com.mx/MLM-XXXXX",
        imageUrl: "https://i.imgur.com/XXXXX.png",
        description: "Malla sombra beige 90% confeccionada con refuerzos y ojillos, medida 3x4 metros."
      },
      {
        familyId: familyMalla._id,
        subfamilyId: subBeige._id,
        name: "Malla sombra beige 90% 4x6m",
        type: "confeccionada",
        size: "4x6m",
        price: "650",
        mLink: "https://articulo.mercadolibre.com.mx/MLM-YYYYY",
        imageUrl: "https://i.imgur.com/YYYYY.png",
        description: "Malla sombra beige 90% confeccionada con refuerzos y ojillos, medida 4x6 metros."
      },
      {
        familyId: familyMalla._id,
        subfamilyId: subBeige._id,
        name: "Rollo malla sombra beige 90% 4.2x25m",
        type: "rollo",
        size: "4.2x25m",
        price: "3800",
        mLink: "https://articulo.mercadolibre.com.mx/MLM-ZZZZZ",
        imageUrl: "https://i.imgur.com/ZZZZZ.png",
        description: "Rollo completo de malla sombra beige 90% de 4.2 metros de ancho por 25 metros de largo."
      }
    ];

    await Product.insertMany(products);
    console.log("🧾 Productos insertados correctamente:", products.length);

    await mongoose.disconnect();
    console.log("🔌 Desconectado de MongoDB. Proceso completo.");
  } catch (err) {
    console.error("❌ Error en seed:", err);
  }
}

seed();
