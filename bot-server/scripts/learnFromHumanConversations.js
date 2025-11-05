// scripts/learnFromHumanConversations.js
// Analyzes human-handled conversations to extract successful response patterns

require("dotenv").config();
const mongoose = require("mongoose");
const { OpenAI } = require("openai");

const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });
const Message = require("../models/Message");

async function learnFromHumanConversations() {
  console.log("🎓 LEARNING FROM HUMAN CONVERSATIONS");
  console.log("=".repeat(70));

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB\n");

    // Get all messages, grouped by conversation
    const messages = await Message.find()
      .sort({ timestamp: 1 })
      .lean();

    if (messages.length === 0) {
      console.log("⚠️  No messages found. Import conversations first:");
      console.log("  node scripts/importConversations.js");
      await mongoose.disconnect();
      return;
    }

    console.log(`📚 Found ${messages.length} messages\n`);

    // Group by conversation (psid)
    const conversations = {};
    messages.forEach(msg => {
      if (!conversations[msg.psid]) {
        conversations[msg.psid] = [];
      }
      conversations[msg.psid].push(msg);
    });

    console.log(`💬 Analyzing ${Object.keys(conversations).length} conversations...\n`);

    // Extract question-answer pairs
    const qaPairs = [];

    for (const [psid, msgs] of Object.entries(conversations)) {
      for (let i = 0; i < msgs.length - 1; i++) {
        const current = msgs[i];
        const next = msgs[i + 1];

        // Find user questions followed by rep answers
        if (current.senderType === "user" && next.senderType === "bot") {
          qaPairs.push({
            question: current.text,
            answer: next.text,
            timestamp: current.timestamp
          });
        }
      }
    }

    console.log(`✅ Extracted ${qaPairs.length} question-answer pairs\n`);

    if (qaPairs.length === 0) {
      console.log("⚠️  No Q&A pairs found. Make sure your conversations have alternating user/rep messages.");
      await mongoose.disconnect();
      return;
    }

    // 1. ANALYZE SUCCESSFUL PATTERNS
    console.log("📊 ANALYZING SUCCESSFUL RESPONSE PATTERNS");
    console.log("-".repeat(70));

    // Take sample for AI analysis
    const sampleSize = Math.min(50, qaPairs.length);
    const sample = qaPairs.slice(0, sampleSize);

    const analysisPrompt = `Analiza estas conversaciones reales entre clientes y representantes de ventas de una tienda de mallas sombra.

IMPORTANTE: Estas son conversaciones REALES donde un humano respondió exitosamente. Son EJEMPLOS DE LO QUE EL BOT DEBE APRENDER.

Identifica:
1. Patrones de preguntas comunes
2. Qué respuestas funcionaron bien
3. Estilo de comunicación del representante (tono, emojis, estructura)
4. Tácticas de venta efectivas

Conversaciones:
${sample.map((qa, i) => `\n${i + 1}.\nCliente: ${qa.question}\nRepresentante: ${qa.answer}`).join('\n')}

Responde en formato JSON:
{
  "patterns": [
    {
      "questionType": "tipo de pregunta",
      "commonPhrases": ["frase1", "frase2"],
      "successfulResponse": "ejemplo de respuesta que funcionó",
      "responseStrategy": "estrategia utilizada (directa, consultiva, educativa, etc)",
      "keyElements": ["elemento1", "elemento2"]
    }
  ],
  "communicationStyle": {
    "tone": "descripción del tono",
    "emojiUsage": "cómo y cuándo usa emojis",
    "structure": "estructura típica de respuestas",
    "saleTactics": ["táctica1", "táctica2"]
  },
  "bestPractices": ["práctica1", "práctica2", "práctica3"]
}`;

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: analysisPrompt }],
        temperature: 0.3,
        response_format: { type: "json_object" }
      });

      const analysis = JSON.parse(response.choices[0].message.content);

      // Display patterns
      if (analysis.patterns && analysis.patterns.length > 0) {
        console.log(`\nFound ${analysis.patterns.length} successful response patterns:\n`);

        analysis.patterns.forEach((pattern, i) => {
          console.log(`\n${i + 1}. ${pattern.questionType}`);
          console.log(`   Common phrases: ${pattern.commonPhrases.join(', ')}`);
          console.log(`   Strategy: ${pattern.responseStrategy}`);
          console.log(`   Example response: "${pattern.successfulResponse}"`);
          console.log(`   Key elements: ${pattern.keyElements.join(', ')}`);
        });
      }

      // Display communication style
      if (analysis.communicationStyle) {
        console.log("\n\n💬 COMMUNICATION STYLE ANALYSIS");
        console.log("-".repeat(70));
        console.log(`Tone: ${analysis.communicationStyle.tone}`);
        console.log(`Emoji usage: ${analysis.communicationStyle.emojiUsage}`);
        console.log(`Structure: ${analysis.communicationStyle.structure}`);
        if (analysis.communicationStyle.saleTactics) {
          console.log(`\nSale tactics:`);
          analysis.communicationStyle.saleTactics.forEach(tactic => {
            console.log(`  • ${tactic}`);
          });
        }
      }

      // Display best practices
      if (analysis.bestPractices && analysis.bestPractices.length > 0) {
        console.log("\n\n✨ BEST PRACTICES IDENTIFIED");
        console.log("-".repeat(70));
        analysis.bestPractices.forEach(practice => {
          console.log(`  ✓ ${practice}`);
        });
      }

    } catch (error) {
      console.log("⚠️  Could not analyze patterns:", error.message);
    }

    // 2. GENERATE BOT RESPONSES FOR COMPARISON
    console.log("\n\n🤖 COMPARING BOT VS HUMAN RESPONSES");
    console.log("-".repeat(70));
    console.log("Testing how the bot would handle these questions...\n");

    const { generateReply } = require("../ai/index");
    const { resetConversation } = require("../conversationManager");

    // Test 5 random questions
    const testQuestions = qaPairs
      .sort(() => Math.random() - 0.5)
      .slice(0, 5);

    for (const qa of testQuestions) {
      const testPsid = `test_${Date.now()}_${Math.random()}`;
      await resetConversation(testPsid);

      console.log(`\n${"─".repeat(70)}`);
      console.log(`Customer: "${qa.question}"`);
      console.log(`\nHuman rep answered:\n"${qa.answer}"`);

      try {
        const botResponse = await generateReply(qa.question, testPsid);
        console.log(`\nBot would answer:\n"${botResponse.text}"`);

        // Quick comparison
        if (botResponse.text.toLowerCase().includes(qa.answer.toLowerCase().slice(0, 20))) {
          console.log(`✅ Similar approach`);
        } else {
          console.log(`⚠️ Different approach - review if human response is better`);
        }
      } catch (error) {
        console.log(`❌ Bot error: ${error.message}`);
      }
    }

    // 3. RECOMMENDATIONS
    console.log("\n\n💡 RECOMMENDATIONS FOR BOT IMPROVEMENT");
    console.log("-".repeat(70));

    const recommendPrompt = `Basándote en estos ${qaPairs.length} pares de pregunta-respuesta de conversaciones reales exitosas,
¿qué mejoras específicas recomendarías para el bot?

Considera:
- Respuestas que el bot debería aprender
- Patrones de preguntas que necesitan nuevos handlers
- Ajustes de tono o estilo
- Tácticas de venta que funcionan

Responde con una lista concisa de 5-10 mejoras accionables.`;

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "Eres un experto en diseño de chatbots conversacionales para ventas."
          },
          {
            role: "user",
            content: recommendPrompt + "\n\nEjemplos:\n" +
              sample.slice(0, 10).map(qa => `Q: ${qa.question}\nA: ${qa.answer}`).join("\n\n")
          }
        ],
        temperature: 0.4
      });

      const recommendations = response.choices[0].message.content;
      console.log("\n" + recommendations);

    } catch (error) {
      console.log("⚠️  Could not generate recommendations:", error.message);
    }

    console.log("\n" + "=".repeat(70));
    console.log("✅ Analysis complete!\n");

  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await mongoose.disconnect();
  }
}

learnFromHumanConversations();
