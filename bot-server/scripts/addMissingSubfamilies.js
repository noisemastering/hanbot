const mongoose = require("mongoose");
require("dotenv").config();

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const ProductSubfamily = require("../models/ProductSubfamily");
  const ProductFamily = require("../models/ProductFamily");

  // Find family IDs
  const mallaAntiafido = await ProductFamily.findOne({ name: /Malla Antiáfido/i });
  const cintaPlastica = await ProductFamily.findOne({ name: /Cinta Plástica/i });

  // Add Malla Antiáfido if missing
  const existsAnti = await ProductSubfamily.findOne({ name: /Antiáfido/i });
  if (!existsAnti && mallaAntiafido) {
    await ProductSubfamily.create({
      familyId: mallaAntiafido._id,
      name: "Malla Antiáfido",
      description: "Malla de polietileno con tejido muy fino (40x25 hilos por pulgada). Protege cultivos de insectos pequeños como áfidos, mosca blanca y trips, sin bloquear la luz. Ideal para invernaderos y casas sombra.",
      materials: "Monofilamentos de polietileno de alta densidad (HDPE) con protección UV.",
      available: true
    });
    console.log("✅ Added: Malla Antiáfido");
  } else {
    console.log("⏭️  Malla Antiáfido already exists or no family found");
  }

  // Add Cinta Plástica if missing
  const existsCinta = await ProductSubfamily.findOne({ name: /Cinta Plástica|Cinta Rígida/i });
  if (!existsCinta && cintaPlastica) {
    await ProductSubfamily.create({
      familyId: cintaPlastica._id,
      name: "Cinta Plástica",
      description: "Cinta de polipropileno resistente a la intemperie. Disponible en varios anchos. Ideal para reforzar, sujetar o marcar en jardines, construcción y agricultura.",
      materials: "Polipropileno resistente UV.",
      available: true
    });
    console.log("✅ Added: Cinta Plástica");
  } else {
    console.log("⏭️  Cinta Plástica already exists or no family found");
  }

  console.log("\nDone!");
  await mongoose.disconnect();
})();
