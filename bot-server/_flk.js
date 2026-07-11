require("dotenv").config();const m=require("mongoose");
require("./models/ProductFamily");require("./models/Product");require("./models/Promo");
const WF=require("./models/Workflow");const { runWorkflowTurn, initState }=require("./ai/workflow");
const setup={buyer:"end_user",tone:"casual",purchaseType:"retail",saleChannel:"marketplace",hasPromo:"69cdbaf4e85f61fda9122664",products:[{kind:"family",id:"6942d85ba539ce7f9f28429b",name:"Rectangular"}],catalog:{kind:"store_link"}};
const seq=["Comprar promoción Malla Sombra 6x4 m.","ok","una de 3 por 6","76095","cómo se ase la compra bes pago contra entrega"];
(async()=>{
  await m.connect(process.env.MONGODB_URI||process.env.MONGO_URI);
  const wf=await WF.findOne({name:/Confeccionada con Refuerzo — Venta Retail/i,active:true});
  for(let run=1;run<=4;run++){
    let s=initState(wf,{},setup);s.workflowId=String(wf._id);let last;
    for(const t of seq){const o=await runWorkflowTurn(wf,s,t,{psid:"FLK"+run,sandbox:true,personaName:"C"});s=o.state;last=o;}
    const r=(last.reply||"").replace(/\n/g," ");
    const handoff=last.diagnostics?.handoffRequested||/te paso con un asesor|nombre y un tel/i.test(r);
    console.log(`RUN${run}|${handoff?"❌ HANDOFF":"✅ EXPLAIN"}|${r.slice(0,90)}`);
  }
  await m.connection.close();
})().catch(e=>{console.error(e);process.exit(1)});
