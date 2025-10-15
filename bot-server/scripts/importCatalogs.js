// scripts/importCatalog.js
require("dotenv").config();
const mongoose = require("mongoose");
const Product = require("../models/Product");

const sampleProducts = [
  {
    name: "Malla Sombra Negra 80%",
    description: "Protege tus plantas del sol, ideal para viveros y jardines.",
    price: 399,
    mlLink: "https://articulo.mercadolibre.com.mx/MLM-123456789",
    imageUrl: "https://http2.mlstatic.com/D_NQ_NP_12345-MLM123.jpg",
    tags: ["malla sombra", "negra", "vivero", "80%"]
  }
];

mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    await Product.deleteMany({});
    await Product.insertMany(sampleProducts);
    console.log("✅ Catálogo importado correctamente");
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Error al importar catálogo:", err);
    process.exit(1);
  });
