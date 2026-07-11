require("dotenv").config({quiet:true}); const m=require("mongoose");
const Conversation=require("../models/Conversation");
const mx=(t)=>t?new Date(t).toLocaleString("en-US",{timeZone:"America/Mexico_City"}):"—";
(async()=>{ await m.connect(process.env.MONGODB_URI||process.env.MONGO_URI);
  const c=await Conversation.findOne({psid:"24317313684533180"}).lean();
  if(!c){console.log("NOT FOUND");process.exit(0);}
  const rows={
    state:c.state, lastIntent:c.lastIntent,
    handoffRequested:c.handoffRequested, handoffReason:c.handoffReason,
    handoffTimestamp:mx(c.handoffTimestamp),
    assignedAgent:c.assignedAgent, agentName:c.agentName,
    agentTookOverAt:mx(c.agentTookOverAt),
    pendingHandoff:c.pendingHandoff, pendingHandoffAt:mx(c.pendingHandoffAt),
    handoffResolved:c.handoffResolved, handoffResolvedAt:mx(c.handoffResolvedAt),
    lastMessageAt:mx(c.lastMessageAt), unknownCount:c.unknownCount,
    preHandoffAttempts:c.preHandoffAttempts,
  };
  for(const k in rows) console.log(k.padEnd(20), JSON.stringify(rows[k]));
  // try Message collection
  try{ const Message=require("../models/Message");
    const ms=await Message.find({psid:"24317313684533180"}).sort({timestamp:1}).lean();
    console.log("\n---- Message coll: "+ms.length+" msgs, last 14 ----");
    for(const x of ms.slice(-14)) console.log(`[${mx(x.timestamp||x.createdAt)}] ${x.sender||x.role||x.from}: ${String(x.text||x.content||"").slice(0,75).replace(/\n/g," ")}`);
  }catch(e){ console.log("(no Message model: "+e.message+")"); }
  await m.connection.close(); })().catch(e=>{console.error(e);process.exit(1)});
