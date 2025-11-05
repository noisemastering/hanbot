// scripts/cleanupConversations.js
// Review and clean up imported conversations before analysis

require("dotenv").config();
const mongoose = require("mongoose");
const readline = require("readline");

const Message = require("../models/Message");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function cleanupConversations() {
  console.log("🧹 CLEANUP IMPORTED CONVERSATIONS");
  console.log("=".repeat(70));

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB\n");

    const messages = await Message.find().sort({ timestamp: 1 });

    if (messages.length === 0) {
      console.log("⚠️  No messages found. Nothing to clean up.");
      rl.close();
      await mongoose.disconnect();
      return;
    }

    // Group by conversation (psid)
    const conversations = {};
    messages.forEach(msg => {
      if (!conversations[msg.psid]) {
        conversations[msg.psid] = [];
      }
      conversations[msg.psid].push(msg);
    });

    const convos = Object.entries(conversations);
    console.log(`📊 Found ${convos.length} conversations with ${messages.length} total messages\n`);

    console.log("Commands:");
    console.log("  [number] - View conversation details");
    console.log("  d [number] - Delete entire conversation");
    console.log("  list - List all conversations again");
    console.log("  stats - Show statistics");
    console.log("  done - Finish cleanup");
    console.log("=".repeat(70));
    console.log("");

    // Show conversations list
    function showList() {
      console.log("\n📋 CONVERSATIONS LIST:");
      console.log("-".repeat(70));
      convos.forEach(([psid, msgs], i) => {
        const userMsgs = msgs.filter(m => m.senderType === "user").length;
        const botMsgs = msgs.filter(m => m.senderType === "bot").length;
        const preview = msgs[0].text.slice(0, 40);
        console.log(`${i + 1}. [${msgs.length} msgs: ${userMsgs}👤 ${botMsgs}🤖] "${preview}${msgs[0].text.length > 40 ? '...' : ''}"`);
      });
      console.log("");
    }

    showList();

    let done = false;
    let deletedCount = 0;

    while (!done) {
      const input = await question("Command: ");
      const cmd = input.trim().toLowerCase();

      if (cmd === "done") {
        done = true;
        console.log("\n✅ Cleanup complete!");
        if (deletedCount > 0) {
          console.log(`🗑️  Deleted ${deletedCount} conversations`);
          console.log(`📊 Remaining: ${convos.length - deletedCount} conversations`);
        }
      } else if (cmd === "list") {
        showList();
      } else if (cmd === "stats") {
        const remaining = convos.filter(([_, msgs]) => msgs.length > 0);
        const totalMsgs = remaining.reduce((sum, [_, msgs]) => sum + msgs.length, 0);
        const userMsgs = remaining.reduce((sum, [_, msgs]) =>
          sum + msgs.filter(m => m.senderType === "user").length, 0);
        const botMsgs = remaining.reduce((sum, [_, msgs]) =>
          sum + msgs.filter(m => m.senderType === "bot").length, 0);

        console.log("\n📊 STATISTICS:");
        console.log(`  Total conversations: ${remaining.length}`);
        console.log(`  Total messages: ${totalMsgs}`);
        console.log(`  Customer messages: ${userMsgs}`);
        console.log(`  Rep/Bot messages: ${botMsgs}`);
        console.log(`  Deleted so far: ${deletedCount}\n`);
      } else if (cmd.startsWith("d ")) {
        // Delete conversation
        const num = parseInt(cmd.split(" ")[1]);
        if (num > 0 && num <= convos.length) {
          const [psid, msgs] = convos[num - 1];
          if (msgs.length === 0) {
            console.log("⚠️  Already deleted!\n");
          } else {
            const confirm = await question(`Delete conversation ${num} (${msgs.length} messages)? (y/n): `);
            if (confirm.toLowerCase() === "y") {
              await Message.deleteMany({ psid });
              console.log(`✅ Deleted conversation ${num}\n`);
              convos[num - 1][1] = []; // Mark as deleted locally
              deletedCount++;
            } else {
              console.log("❌ Cancelled\n");
            }
          }
        } else {
          console.log("⚠️  Invalid conversation number\n");
        }
      } else if (!isNaN(cmd)) {
        // View conversation details
        const num = parseInt(cmd);
        if (num > 0 && num <= convos.length) {
          const [psid, msgs] = convos[num - 1];

          if (msgs.length === 0) {
            console.log("\n⚠️  This conversation was deleted\n");
          } else {
            console.log("\n" + "─".repeat(70));
            console.log(`CONVERSATION ${num} (${msgs.length} messages)`);
            console.log(`PSID: ${psid}`);
            console.log("─".repeat(70));

            msgs.forEach((msg, i) => {
              const icon = msg.senderType === "user" ? "👤" : "🤖";
              const label = msg.senderType === "user" ? "Customer" : "Rep";
              console.log(`\n${i + 1}. ${icon} ${label}:`);
              console.log(`   "${msg.text}"`);
            });

            console.log("\n" + "─".repeat(70));

            const deleteCmd = await question(`\nDelete this conversation? (y/n): `);
            if (deleteCmd.toLowerCase() === "y") {
              await Message.deleteMany({ psid });
              console.log(`✅ Deleted conversation ${num}\n`);
              convos[num - 1][1] = []; // Mark as deleted locally
              deletedCount++;
            } else {
              console.log("✅ Kept conversation\n");
            }
          }
        } else {
          console.log("⚠️  Invalid conversation number\n");
        }
      } else {
        console.log("⚠️  Unknown command. Use: [number], d [number], list, stats, or done\n");
      }
    }

    rl.close();
    await mongoose.disconnect();

  } catch (error) {
    console.error("❌ Error:", error);
    rl.close();
    await mongoose.disconnect();
  }
}

cleanupConversations();
