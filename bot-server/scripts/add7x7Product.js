require("dotenv").config();
const mongoose = require("mongoose");
const Product = require("../models/Product");
const ProductFamily = require("../models/ProductFamily");
const ProductSubfamily = require("../models/ProductSubfamily");

async function add7x7() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB");

    // Find existing family and subfamily
    const familyMalla = await ProductFamily.findOne({ name: "Malla sombra" });
    if (!familyMalla) {
      console.error("❌ Family 'Malla sombra' not found");
      process.exit(1);
    }

    const subBeige = await ProductSubfamily.findOne({
      familyId: familyMalla._id,
      name: "Beige"
    });
    if (!subBeige) {
      console.error("❌ Subfamily 'Beige' not found");
      process.exit(1);
    }

    console.log(`📋 Found Family: ${familyMalla.name} (${familyMalla._id})`);
    console.log(`📋 Found Subfamily: ${subBeige.name} (${subBeige._id})`);

    // Check if 7x7m already exists
    const existing = await Product.findOne({ size: "7x7m", type: "confeccionada" });
    if (existing) {
      console.log("⚠️  7x7m product already exists. Updating it...");
      existing.price = "2700";
      existing.name = "Malla sombra beige 90% 7x7m";
      existing.description = "Malla sombra beige 90% confeccionada con refuerzos y ojillos, medida 7x7 metros.";
      await existing.save();
      console.log("✅ 7x7m product updated successfully!");
    } else {
      // Add new 7x7m product
      const product7x7 = await Product.create({
        familyId: familyMalla._id,
        subfamilyId: subBeige._id,
        name: "Malla sombra beige 90% 7x7m",
        type: "confeccionada",
        size: "7x7m",
        price: "2700",
        mLink: "https://articulo.mercadolibre.com.mx/MLM-7x7",
        imageUrl: "https://i.imgur.com/7x7.png",
        description: "Malla sombra beige 90% confeccionada con refuerzos y ojillos, medida 7x7 metros."
      });

      console.log("✅ 7x7m product added successfully!");
      console.log("📦 Product:", product7x7.name, "-", product7x7.size, "-", "$" + product7x7.price);
    }

    // Verify it exists
    const verify = await Product.findOne({ size: "7x7m", type: "confeccionada" });
    console.log("✅ Verification: 7x7m exists:", verify ? "YES ✅" : "NO ❌");

    await mongoose.disconnect();
    console.log("🔌 Disconnected from MongoDB");
  } catch (err) {
    console.error("❌ Error:", err);
    process.exit(1);
  }
}

add7x7();
