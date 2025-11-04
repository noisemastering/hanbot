require("dotenv").config();
const { OpenAI } = require("openai");
const { analyzeImage, generateImageResponse } = require("./ai/core/imageAnalyzer");

// Test image analysis with a URL
const IMAGE_URL = process.argv[2] || "https://example.com/test-image.jpg";

(async () => {
  console.log("========================================");
  console.log("IMAGE ANALYSIS TEST");
  console.log("========================================\n");

  console.log(`🖼️  Image URL: ${IMAGE_URL}\n`);

  const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

  try {
    console.log("⏳ Analyzing image with GPT-4 Vision...\n");

    const analysisResult = await analyzeImage(IMAGE_URL, openai);

    if (analysisResult.success) {
      console.log("✅ ANALYSIS SUCCESSFUL\n");
      console.log("📝 Analysis:");
      console.log("─".repeat(50));
      console.log(analysisResult.analysis);
      console.log("─".repeat(50));
      console.log("\n");

      const response = generateImageResponse(analysisResult);
      console.log("💬 Bot Response:");
      console.log("─".repeat(50));
      console.log(response.text);
      console.log("─".repeat(50));
    } else {
      console.log("❌ ANALYSIS FAILED");
      console.log(`Error: ${analysisResult.error}`);
    }

  } catch (error) {
    console.error("❌ Test error:", error.message);
  }

  console.log("\n========================================");
  console.log("TEST COMPLETE");
  console.log("========================================");
})();
