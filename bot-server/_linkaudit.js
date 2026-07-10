require("dotenv").config();
const m=require("mongoose");const axios=require("axios");const fs=require("fs");
require("./models/ProductFamily");
const { getValidAccessToken }=require("./utils/mercadoLibreOAuth");
const { extractMLItemId }=require("./ai/utils/mlPriceLookup");
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  await m.connect(process.env.MONGODB_URI||process.env.MONGO_URI);
  const PF=m.model("ProductFamily");
  const path=async(id)=>{const o=[];let c=await PF.findById(id).select("name parentId").lean();let i=0;while(c&&i++<8){o.unshift(c.name);c=c.parentId?await PF.findById(c.parentId).select("name parentId").lean():null;}return o.join(" > ");};
  const fams=await PF.find({"onlineStoreLinks.0":{$exists:true}}).select("name parentId onlineStoreLinks").lean();
  // map id → {url, familyIds:Set}
  const byId=new Map();
  for(const f of fams){
    for(const l of (f.onlineStoreLinks||[])){
      if(!l.url||!/mercadolibre/i.test(l.url)) continue;
      const id=extractMLItemId(l.url); if(!id) continue;
      if(!byId.has(id)) byId.set(id,{url:l.url,fams:[]});
      byId.get(id).fams.push(f._id);
    }
  }
  console.log(`families with links: ${fams.length} | unique ML ids: ${byId.size}`);
  const token=await getValidAccessToken("482595248");
  const H={headers:{Authorization:`Bearer ${token}`},timeout:6000};
  const alive=async(id)=>{
    // MLMU → catalog; MLM → item then catalog fallback
    if(/^MLMU/i.test(id)){ try{const r=await axios.get(`https://api.mercadolibre.com/products/${id}/items`,H);return (r.data?.results||[]).length>0;}catch{return false;} }
    try{ const r=await axios.get(`https://api.mercadolibre.com/items/${id}`,H); return r.data?.status!=="closed"; }catch{}
    try{ const r=await axios.get(`https://api.mercadolibre.com/products/${id}/items`,H); return (r.data?.results||[]).length>0; }catch{}
    return false;
  };
  const dead=[]; let ok=0, n=0;
  for(const [id,info] of byId){
    n++;
    const isAlive=await alive(id);
    if(isAlive) ok++; else { dead.push({id,url:info.url,fam:await path(info.fams[0])}); }
    if(n%25===0) console.log(`  …${n}/${byId.size} checked (${dead.length} dead)`);
    await sleep(120);
  }
  console.log(`\n════ RESULT: ${ok} alive / ${dead.length} DEAD (of ${byId.size}) ════`);
  fs.writeFileSync("/tmp/dead_links.json",JSON.stringify(dead,null,1));
  dead.forEach(d=>console.log(`❌ ${d.id}\n   ${d.fam}\n   ${d.url}`));
  await m.connection.close();
})().catch(e=>{console.error(e.response?.status||e.message);process.exit(1)});
