// scripts/analyzeConversations.js
// Analyzes IntentLog to find patterns and improvement opportunities

require("dotenv").config();
const mongoose = require("mongoose");
const { OpenAI } = require("openai");

const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

const IntentLogSchema = new mongoose.Schema({
  psid: String,
  message: String,
  detectedIntent: String,
  confidence: Number,
  availableIntents: [String],
  timestamp: { type: Date, default: Date.now },
  responseGenerated: Boolean,
  context: Object
});

const IntentLog = mongoose.model("IntentLog", IntentLogSchema);

async function analyzeConversations() {
  console.log("📊 CONVERSATION ANALYSIS REPORT");
  console.log("=" .repeat(70));

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB\n");

    // Get last 7 days of data
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const logs = await IntentLog.find({
      timestamp: { $gte: sevenDaysAgo }
    }).sort({ timestamp: -1 });

    console.log(`📈 Analyzing ${logs.length} conversations from the last 7 days\n`);

    // 1. LOW CONFIDENCE CLASSIFICATIONS
    console.log("🔍 LOW CONFIDENCE CLASSIFICATIONS (< 70%)");
    console.log("-".repeat(70));

    const lowConfidence = logs.filter(log => log.confidence < 0.7);

    if (lowConfidence.length > 0) {
      console.log(`Found ${lowConfidence.length} low-confidence classifications:\n`);

      // Group by intent
      const byIntent = {};
      lowConfidence.forEach(log => {
        if (!byIntent[log.detectedIntent]) {
          byIntent[log.detectedIntent] = [];
        }
        byIntent[log.detectedIntent].push(log);
      });

      for (const [intent, items] of Object.entries(byIntent)) {
        console.log(`\n${intent} (${items.length} occurrences):`);
        items.slice(0, 5).forEach(item => {
          console.log(`  - "${item.message}" (confidence: ${(item.confidence * 100).toFixed(0)}%)`);
        });
        if (items.length > 5) {
          console.log(`  ... and ${items.length - 5} more`);
        }
      }
    } else {
      console.log("✅ No low-confidence classifications found!\n");
    }

    // 2. UNKNOWN INTENTS
    console.log("\n\n❓ UNKNOWN/FAILED INTENTS");
    console.log("-".repeat(70));

    const unknown = logs.filter(log => log.detectedIntent === "unknown");

    if (unknown.length > 0) {
      console.log(`Found ${unknown.length} unknown intents:\n`);
      unknown.slice(0, 10).forEach(log => {
        console.log(`  - "${log.message}"`);
      });
      if (unknown.length > 10) {
        console.log(`  ... and ${unknown.length - 10} more`);
      }
    } else {
      console.log("✅ No unknown intents found!\n");
    }

    // 3. INTENT DISTRIBUTION
    console.log("\n\n📊 INTENT DISTRIBUTION");
    console.log("-".repeat(70));

    const intentCounts = {};
    logs.forEach(log => {
      intentCounts[log.detectedIntent] = (intentCounts[log.detectedIntent] || 0) + 1;
    });

    const sorted = Object.entries(intentCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    console.log("\nTop 10 intents:");
    sorted.forEach(([intent, count]) => {
      const percentage = ((count / logs.length) * 100).toFixed(1);
      const bar = "█".repeat(Math.floor(percentage / 2));
      console.log(`${intent.padEnd(25)} ${bar} ${count} (${percentage}%)`);
    });

    // 4. AVERAGE CONFIDENCE BY INTENT
    console.log("\n\n📈 AVERAGE CONFIDENCE BY INTENT");
    console.log("-".repeat(70));

    const confidenceByIntent = {};
    logs.forEach(log => {
      if (!confidenceByIntent[log.detectedIntent]) {
        confidenceByIntent[log.detectedIntent] = { sum: 0, count: 0 };
      }
      confidenceByIntent[log.detectedIntent].sum += log.confidence;
      confidenceByIntent[log.detectedIntent].count += 1;
    });

    const avgConfidence = Object.entries(confidenceByIntent)
      .map(([intent, data]) => ({
        intent,
        avg: data.sum / data.count,
        count: data.count
      }))
      .sort((a, b) => a.avg - b.avg)
      .slice(0, 10);

    console.log("\nLowest average confidence (needs improvement):");
    avgConfidence.forEach(item => {
      const status = item.avg < 0.7 ? "⚠️" : item.avg < 0.85 ? "⚡" : "✅";
      console.log(`${status} ${item.intent.padEnd(25)} ${(item.avg * 100).toFixed(1)}% (${item.count} samples)`);
    });

    // 5. CLUSTERING SUGGESTIONS
    if (unknown.length > 5) {
      console.log("\n\n🔗 CLUSTERING UNKNOWN QUESTIONS");
      console.log("-".repeat(70));
      console.log("Analyzing similar questions using AI...\n");

      // Group unknown messages for clustering
      const unknownMessages = unknown.slice(0, 30).map(log => log.message);

      const clusterPrompt = `Analyze these customer questions and group similar ones into clusters.
For each cluster, suggest a clear intent name and show 2-3 example questions.

Questions:
${unknownMessages.map((msg, i) => `${i + 1}. ${msg}`).join('\n')}

Return a JSON array of clusters in this format:
[
  {
    "suggestedIntent": "delivery_time",
    "description": "Questions about delivery/shipping time",
    "examples": ["cuando llega?", "cuanto tarda?"],
    "count": 5
  }
]`;

      try {
        const response = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: clusterPrompt }],
          temperature: 0.3,
          response_format: { type: "json_object" }
        });

        const result = JSON.parse(response.choices[0].message.content);
        const clusters = result.clusters || [];

        if (clusters.length > 0) {
          console.log(`Found ${clusters.length} question clusters:\n`);
          clusters.forEach((cluster, i) => {
            console.log(`\nCluster ${i + 1}: ${cluster.suggestedIntent}`);
            console.log(`Description: ${cluster.description}`);
            console.log(`Examples:`);
            cluster.examples.forEach(ex => console.log(`  - "${ex}"`));
          });
        }
      } catch (error) {
        console.log("⚠️  Could not cluster questions:", error.message);
      }
    }

    // 6. RECOMMENDATIONS
    console.log("\n\n💡 RECOMMENDATIONS");
    console.log("-".repeat(70));

    const recommendations = [];

    if (lowConfidence.length > logs.length * 0.1) {
      recommendations.push("• More than 10% of classifications have low confidence - consider refining intent descriptions");
    }

    if (unknown.length > logs.length * 0.05) {
      recommendations.push(`• ${unknown.length} unknown intents detected - add new intent handlers for common patterns`);
    }

    const lowAvgIntents = avgConfidence.filter(i => i.avg < 0.7 && i.count > 3);
    if (lowAvgIntents.length > 0) {
      recommendations.push(`• These intents have consistently low confidence: ${lowAvgIntents.map(i => i.intent).join(', ')}`);
    }

    if (recommendations.length > 0) {
      console.log("");
      recommendations.forEach(rec => console.log(rec));
    } else {
      console.log("\n✅ Bot is performing well! No critical issues detected.");
    }

    console.log("\n" + "=".repeat(70));
    console.log("✅ Analysis complete!\n");

  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await mongoose.disconnect();
  }
}

analyzeConversations();
