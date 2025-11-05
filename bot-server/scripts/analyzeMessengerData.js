// scripts/analyzeMessengerData.js
// Analyzes raw Messenger conversations to find patterns and improvement opportunities

require("dotenv").config();
const mongoose = require("mongoose");
const { OpenAI } = require("openai");

const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

// Use existing Message model
const Message = require("../models/Message");

async function analyzeMessengerData() {
  console.log("📊 MESSENGER CONVERSATION ANALYSIS");
  console.log("=".repeat(70));

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB\n");

    // Get last 7 days of user messages
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const userMessages = await Message.find({
      senderType: "user",
      timestamp: { $gte: sevenDaysAgo }
    })
      .sort({ timestamp: -1 })
      .lean();

    console.log(`📈 Analyzing ${userMessages.length} user messages from the last 7 days\n`);

    if (userMessages.length === 0) {
      console.log("⚠️  No messages found in the last 7 days. Try a longer time period or check your Message collection.");
      await mongoose.disconnect();
      return;
    }

    // 1. MOST COMMON QUESTIONS
    console.log("🔥 MOST COMMON QUESTIONS");
    console.log("-".repeat(70));

    // Count exact message frequency
    const messageCounts = {};
    userMessages.forEach(msg => {
      const normalized = msg.text.toLowerCase().trim();
      messageCounts[normalized] = (messageCounts[normalized] || 0) + 1;
    });

    const topMessages = Object.entries(messageCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);

    console.log("\nTop 20 most frequent messages:\n");
    topMessages.forEach(([msg, count], i) => {
      console.log(`${i + 1}. "${msg}" (${count}x)`);
    });

    // 2. PATTERN DETECTION - Use AI to find patterns
    console.log("\n\n🔍 AI-POWERED PATTERN DETECTION");
    console.log("-".repeat(70));
    console.log("Analyzing message patterns using AI...\n");

    // Take sample of unique messages for AI analysis
    const uniqueMessages = [...new Set(userMessages.map(m => m.text.toLowerCase().trim()))]
      .slice(0, 100); // Analyze first 100 unique messages

    const patternPrompt = `Analiza estos mensajes de clientes de una tienda de mallas sombra en México.

Agrupa mensajes similares en categorías/patrones y sugiere:
1. Qué tipo de intención representa cada patrón
2. Si el bot actual probablemente maneja bien esta intención
3. Qué respuesta sería ideal para este tipo de pregunta

Mensajes:
${uniqueMessages.map((msg, i) => `${i + 1}. ${msg}`).join('\n')}

Responde en formato JSON con este esquema:
{
  "patterns": [
    {
      "category": "nombre_categoria",
      "description": "descripción breve del patrón",
      "examples": ["ejemplo1", "ejemplo2", "ejemplo3"],
      "count": número_estimado,
      "handlingStatus": "well_handled" | "needs_improvement" | "not_handled",
      "suggestedResponse": "respuesta ideal para este tipo de pregunta"
    }
  ]
}`;

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: patternPrompt }],
        temperature: 0.3,
        response_format: { type: "json_object" }
      });

      const analysis = JSON.parse(response.choices[0].message.content);

      if (analysis.patterns && analysis.patterns.length > 0) {
        console.log(`Found ${analysis.patterns.length} conversation patterns:\n`);

        analysis.patterns.forEach((pattern, i) => {
          const statusIcon = pattern.handlingStatus === "well_handled" ? "✅" :
                            pattern.handlingStatus === "needs_improvement" ? "⚠️" : "❌";

          console.log(`\n${i + 1}. ${statusIcon} ${pattern.category}`);
          console.log(`   ${pattern.description}`);
          console.log(`   Examples:`);
          pattern.examples.slice(0, 3).forEach(ex => console.log(`      - "${ex}"`));
          console.log(`   Status: ${pattern.handlingStatus.replace(/_/g, ' ')}`);
          console.log(`   Suggested response: "${pattern.suggestedResponse}"`);
        });
      }
    } catch (error) {
      console.log("⚠️  Could not analyze patterns:", error.message);
    }

    // 3. QUESTION CLUSTERING - Find similar unanswered questions
    console.log("\n\n🔗 CLUSTERING SIMILAR QUESTIONS");
    console.log("-".repeat(70));
    console.log("Grouping similar questions using AI...\n");

    // Focus on questions (messages with question marks or question words)
    const questions = uniqueMessages.filter(msg =>
      msg.includes('?') ||
      /\b(qué|que|cuál|cual|cuánto|cuanto|cómo|como|dónde|donde|cuándo|cuando|por qué|porque|hay|tienen|tienes|existe)\b/i.test(msg)
    ).slice(0, 50);

    if (questions.length > 5) {
      const clusterPrompt = `Agrupa estas preguntas de clientes en clusters de preguntas similares.
Para cada cluster, sugiere:
- Un nombre de intención clara
- Ejemplos representativos
- Una respuesta modelo

Preguntas:
${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Responde en formato JSON:
{
  "clusters": [
    {
      "suggestedIntent": "nombre_de_intencion",
      "description": "descripción del tipo de pregunta",
      "examples": ["ejemplo1", "ejemplo2"],
      "count": número_estimado,
      "suggestedAnswer": "respuesta modelo para este tipo de pregunta"
    }
  ]
}`;

      try {
        const response = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: clusterPrompt }],
          temperature: 0.3,
          response_format: { type: "json_object" }
        });

        const result = JSON.parse(response.choices[0].message.content);

        if (result.clusters && result.clusters.length > 0) {
          console.log(`Found ${result.clusters.length} question clusters:\n`);

          result.clusters.forEach((cluster, i) => {
            console.log(`\nCluster ${i + 1}: ${cluster.suggestedIntent}`);
            console.log(`Description: ${cluster.description}`);
            console.log(`Examples:`);
            cluster.examples.forEach(ex => console.log(`  - "${ex}"`));
            if (cluster.suggestedAnswer) {
              console.log(`Suggested answer: "${cluster.suggestedAnswer}"`);
            }
          });
        }
      } catch (error) {
        console.log("⚠️  Could not cluster questions:", error.message);
      }
    } else {
      console.log(`Only found ${questions.length} questions - need at least 5 for clustering.`);
    }

    // 4. CONVERSATION FLOW ANALYSIS
    console.log("\n\n💬 CONVERSATION FLOW ANALYSIS");
    console.log("-".repeat(70));

    // Group messages by user (psid) to see conversation patterns
    const conversationsByUser = {};
    userMessages.forEach(msg => {
      if (!conversationsByUser[msg.psid]) {
        conversationsByUser[msg.psid] = [];
      }
      conversationsByUser[msg.psid].push(msg);
    });

    const avgMessagesPerUser = (userMessages.length / Object.keys(conversationsByUser).length).toFixed(1);
    const uniqueUsers = Object.keys(conversationsByUser).length;

    console.log(`\n📊 Statistics:`);
    console.log(`   - Unique users: ${uniqueUsers}`);
    console.log(`   - Avg messages per user: ${avgMessagesPerUser}`);
    console.log(`   - Total interactions: ${userMessages.length}`);

    // Find multi-message conversations
    const multiMessageConvos = Object.entries(conversationsByUser)
      .filter(([_, msgs]) => msgs.length > 3)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 5);

    if (multiMessageConvos.length > 0) {
      console.log(`\n📚 Top 5 longest conversations:\n`);
      multiMessageConvos.forEach(([psid, msgs], i) => {
        console.log(`\n${i + 1}. User ${psid.slice(0, 8)}... (${msgs.length} messages):`);
        msgs.slice(0, 5).forEach(msg => {
          console.log(`   - "${msg.text}"`);
        });
        if (msgs.length > 5) {
          console.log(`   ... and ${msgs.length - 5} more messages`);
        }
      });
    }

    // 5. RECOMMENDATIONS
    console.log("\n\n💡 RECOMMENDATIONS");
    console.log("-".repeat(70));

    const recommendations = [];

    if (avgMessagesPerUser > 5) {
      recommendations.push("• High avg messages per user suggests some questions may not be getting satisfactory answers on first try");
    }

    if (topMessages[0][1] > userMessages.length * 0.1) {
      recommendations.push(`• Top question "${topMessages[0][0]}" appears ${topMessages[0][1]} times - ensure this has a perfect response`);
    }

    const shortMessages = userMessages.filter(m => m.text.length < 10).length;
    if (shortMessages > userMessages.length * 0.3) {
      recommendations.push(`• ${shortMessages} very short messages (< 10 chars) - may indicate confusion or yes/no responses`);
    }

    if (recommendations.length > 0) {
      console.log("\n");
      recommendations.forEach(rec => console.log(rec));
    } else {
      console.log("\n✅ Conversations look healthy! Keep monitoring for patterns.");
    }

    console.log("\n" + "=".repeat(70));
    console.log("✅ Analysis complete!\n");

  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await mongoose.disconnect();
  }
}

analyzeMessengerData();
