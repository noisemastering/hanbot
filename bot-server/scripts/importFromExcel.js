// scripts/importFromExcel.js
// Import products from Excel with ML price fetching

require("dotenv").config();
const XLSX = require("xlsx");
const mongoose = require("mongoose");
const axios = require("axios");
const Product = require("../models/Product");
const ProductFamily = require("../models/ProductFamily");

const EXCEL_PATH = "/Users/serch/Downloads/base de datos mallas confeccionadas reforzadas principales.xlsx";

/**
 * Extract size from product name
 * e.g., "MALLA SOMBRAL BEIGE 90% 3 X 4 M REFORZADAS" → "3x4"
 * e.g., "MALLA SOMBRA 90% 3x3x3 M TRIANGULO" → "3x3x3"
 */
function extractSize(productName) {
  // IMPORTANT: Check 3D pattern FIRST, before 2D patterns
  // Otherwise "3x3x3" would match the 2D pattern and return "3x3"

  // Pattern 1: Triangle/3D - "3x3x3", "3 X 3 X 3"
  const match3D = productName.match(/(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)/);
  if (match3D) {
    return `${match3D[1]}x${match3D[2]}x${match3D[3]}`;
  }

  // Pattern 2: Rectangular/2D - "NUM X NUM" or "NUM x NUM"
  const match2D = productName.match(/(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)/);
  if (match2D) {
    return `${match2D[1]}x${match2D[2]}`;
  }

  return null;
}

/**
 * Determine if product is triangular or rectangular
 */
function getProductType(productName) {
  if (/triangulo/i.test(productName)) {
    return "triangular";
  }
  return "rectangular";
}

/**
 * Fetch price from ML product page by scraping HTML
 * Since the API requires authentication, we scrape the public page
 */
async function fetchPriceFromML(mlLink) {
  try {
    // Fetch the HTML page
    const response = await axios.get(mlLink, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-MX,es;q=0.9',
      }
    });

    const html = response.data;

    // Extract price from HTML using regex patterns
    // ML shows price in multiple formats, try different patterns
    const patterns = [
      /"price":"([0-9]+)"/,  // JSON data in script tags
      /"price":([0-9]+)/,     // JSON without quotes
      /content="([0-9]+)" itemprop="price"/,  // Meta tag
      /"price_amount":([0-9]+)/  // Alternative JSON format
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        return parseInt(match[1]);
      }
    }

    console.log(`⚠️  Could not extract price from HTML`);
    return null;
  } catch (error) {
    console.log(`⚠️  Error fetching price: ${error.message}`);
    return null;
  }
}

/**
 * Get image URL from ML page HTML
 */
function fetchImageFromML(html) {
  try {
    // Extract image from HTML
    const patterns = [
      /"images":\["([^"]+)"/,  // JSON array of images
      /data-src="([^"]+)"/,     // Image data-src attribute
      /"secure_thumbnail":"([^"]+)"/  // Thumbnail in JSON
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return null;
  } catch (error) {
    return null;
  }
}

async function importProducts() {
  console.log("📦 IMPORTING PRODUCTS FROM EXCEL");
  console.log("=".repeat(70));
  console.log();

  // Connect to MongoDB
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("✅ Connected to MongoDB");
  console.log();

  // Get the Malla Sombra family ID
  const mallaSombraFamily = await ProductFamily.findOne({ name: "Malla sombra" });
  if (!mallaSombraFamily) {
    throw new Error("Malla sombra family not found. Please create it first.");
  }
  const familyId = mallaSombraFamily._id;
  console.log(`✅ Found family: ${mallaSombraFamily.name} (${familyId})`);
  console.log();

  // Read Excel file
  console.log("📖 Reading Excel file...");
  const workbook = XLSX.readFile(EXCEL_PATH);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet);

  console.log(`Found ${data.length} products in Excel`);
  console.log();

  // Clear existing products
  console.log("🗑️  Clearing existing products...");
  await Product.deleteMany({ type: "confeccionada" });
  console.log("✅ Cleared");
  console.log();

  // Import products
  let imported = 0;
  let failed = 0;

  for (const row of data) {
    const productName = row.Producto;
    const mlLink = row.Link;

    console.log(`Processing: ${productName}`);

    // Extract data
    const size = extractSize(productName);
    const type = getProductType(productName);

    if (!size) {
      console.log(`  ⚠️  Could not extract size, skipping`);
      failed++;
      continue;
    }

    // Fetch HTML page
    console.log(`  🔍 Fetching data from ML...`);
    let html;
    try {
      const response = await axios.get(mlLink, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'es-MX,es;q=0.9',
        }
      });
      html = response.data;
    } catch (error) {
      console.log(`  ⚠️  Could not fetch page: ${error.message}, skipping`);
      failed++;
      continue;
    }

    // Extract price from HTML
    const pricePatterns = [
      /"price":"([0-9]+)"/,
      /"price":([0-9]+)/,
      /content="([0-9]+)" itemprop="price"/,
      /"price_amount":([0-9]+)/
    ];

    let price = null;
    for (const pattern of pricePatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        price = parseInt(match[1]);
        break;
      }
    }

    if (!price) {
      console.log(`  ⚠️  Could not extract price, skipping`);
      failed++;
      continue;
    }

    console.log(`  💰 Price: $${price}`);

    // Extract image from HTML
    const imageUrl = fetchImageFromML(html);

    // Create product
    await Product.create({
      familyId: familyId,
      name: `Malla Sombra Beige ${size}m ${type === "triangular" ? "Triángulo" : ""}`.trim(),
      description: "Malla sombra raschel beige 90% de cobertura, reforzada en esquinas con ojillos metálicos",
      type: "confeccionada",
      size: `${size}m`,
      price: price.toString(),
      mLink: mlLink,
      imageUrl: imageUrl || undefined
    });

    console.log(`  ✅ Imported: ${size}m - $${price}`);
    imported++;

    // Delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log();
  console.log("=".repeat(70));
  console.log(`✅ Import complete!`);
  console.log(`   Imported: ${imported}`);
  console.log(`   Failed: ${failed}`);
  console.log();

  await mongoose.disconnect();
}

importProducts().catch(error => {
  console.error("❌ Error:", error);
  process.exit(1);
});
