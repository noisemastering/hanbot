// scripts/importProducts.js
const fs = require("fs");
const csv = require("csv-parser");
const mongoose = require("mongoose");
const Product = require("../models/Product");
require("dotenv").config();

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch(err => console.error("❌ MongoDB connection error:", err));

const results = [];

fs.createReadStream("Links ML.csv")
  .pipe(csv())
  .on("data", (row) => {
    results.push({
      name: row.name,
      price: row.price,
      mLink: row.mLink,      // 👈 igual al encabezado real
      category: row.category,
      description: row.description
    });
  })
  .on("end", async () => {
    try {
      await Product.deleteMany({});
      await Product.insertMany(results);
      console.log(`✅ Imported ${results.length} products`);
    } catch (err) {
      console.error("❌ Error importing products:", err);
    } finally {
      mongoose.connection.close();
    }
  });
