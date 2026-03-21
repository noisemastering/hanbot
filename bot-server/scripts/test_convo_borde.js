require("dotenv").config();
const mongoose = require("mongoose");

async function test() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to DB\n");

  const convo_borde = require("../ai/flows/convo_bordeSeparadorRetail");

  const fakeConvo = { userName: "Test User" };
  const fakePsid = "test_psid_12345";

  const tests = [
    "Hola, quiero un borde separador",
    "¿Cuánto cuesta?",
    "¿Dónde están ubicados?",
    "¿Tienen de 9 metros?",
    "Quiero malla sombra"
  ];

  let state = {};

  for (const msg of tests) {
    console.log(`👤 Cliente: ${msg}`);
    try {
      const result = await convo_borde.handle(msg, fakeConvo, fakePsid, state);
      if (result.response) {
        console.log(`🤖 Bot: ${result.response.text || JSON.stringify(result.response)}`);
      } else {
        console.log(`🤖 Bot: [no response]`);
      }
      state = result.state;
      console.log(`   State: basket=${state.basket?.length || 0} items, profile=${state.profile}\n`);
    } catch (err) {
      console.log(`❌ Error: ${err.message}\n`);
    }
  }

  await mongoose.disconnect();
}

test().catch(console.error);
