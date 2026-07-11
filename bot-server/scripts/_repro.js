require("dotenv").config({quiet:true}); const m=require("mongoose");
require("../models/ProductFamily"); require("../models/Product"); require("../models/Promo");
const WF=require("../models/Workflow");
const { runWorkflowTurn, initState }=require("../ai/workflow");
(async()=>{ await m.connect(process.env.MONGODB_URI||process.env.MONGO_URI);
  const wf=await WF.findById("6a19d9bda16c14f7db660bcc"); // reforzada retail (has business info)
  let s=initState(wf,{},{}); s.workflowId=String(wf._id); s.contextBlock="";
  const o=await runWorkflowTurn(wf,s,"¿me pasas sus números de teléfono para llamar?",{psid:"REPRO",sandbox:true,personaName:"Miranda"});
  console.log("\n🤖\n"+(o.reply||o.text||""));
  await m.connection.close(); })().catch(e=>{console.error(e);process.exit(1)});
