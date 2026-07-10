require("dotenv").config();
const m=require("mongoose");
require("./models/ProductFamily");require("./models/Product");
const WF=require("./models/Workflow");
const { findProductInFamilies, dimsOf }=require("./ai/workflow/tools");
const { resolvePrice }=require("./ai/workflow/priceResolver");
(async()=>{
  await m.connect(process.env.MONGODB_URI||process.env.MONGO_URI);
  const PF=m.model("ProductFamily");
  const wf=await WF.findOne({name:/con Refuerzo.*Retail/i,active:true}).lean();
  const fams=WF.familyListOf(wf);
  const anc=async(id)=>{const o=[];let c=await PF.findById(id).select("name parentId").lean();let i=0;while(c&&i++<8){o.unshift(c.name);c=c.parentId?await PF.findById(c.parentId).select("name parentId").lean():null;}return o.join(" > ");};
  for(const q of ["8x4","8 x 4","cuanto la de 8x4"]){
    const d=dimsOf(q);
    const doc=await findProductInFamilies(q,fams,d);
    if(doc){ const pi=await resolvePrice(doc); console.log(`"${q}" dims=${JSON.stringify(d)} → ${await anc(doc._id)}  $${pi.amount}`); }
    else console.log(`"${q}" → ∅`);
  }
  // Does a 4x8m product exist + is it sellable/priced?
  const eights=await PF.find({name:/4\s*[x×]\s*8/i}).select("name parentId").lean();
  console.log("\n4x8 size groups:",eights.map(e=>e.name).join(" | ")||"(none)");
  for(const e of eights){ const kids=await PF.find({parentId:e._id}).select("name").lean(); console.log(`  ${e.name} (${await anc(e._id)}) → kids: ${kids.map(k=>k.name).join(", ")||"(leaf)"}`); }
  await m.connection.close();
})().catch(e=>{console.error(e.message);process.exit(1)});
