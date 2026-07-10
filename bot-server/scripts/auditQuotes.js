const mongoose=require('mongoose'); require('dotenv').config();
require('../models/ProductFamily');
const Message=require('../models/Message');
const ClickLog=require('../models/ClickLog');
const { findProductInFamilies } = require('../ai/workflow/tools');
const { resolvePrice } = require('../ai/workflow/priceResolver');

const CONF_FAM=[{id:'6942d85ba539ce7f9f28429b',name:'Rectangular'}];
const dimsFromText=(t)=>{ const m=String(t).toLowerCase().replace(/(\d)\s*m\b/g,'$1 ').match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/); return m?[+m[1],+m[2]].sort((a,b)=>a-b):null; };
const dimsFromUrl=(u)=>{ const m=String(u||'').toLowerCase().match(/(\d+)mx(\d+)m/); return m?[+m[1],+m[2]].sort((a,b)=>a-b):null; };
const priceFromText=(t)=>{ const m=String(t).match(/\$\s?([\d,]+(?:\.\d+)?)/); return m?parseFloat(m[1].replace(/,/g,'')):null; };
const codeFromText=(t)=>{ const m=String(t).match(/\/r\/([a-z0-9]+)/i); return m?m[1]:null; };
const key=d=>d?d.join('x'):null;

(async()=>{
  await mongoose.connect(process.env.MONGODB_URI);
  const cut=new Date('2026-06-23T01:47:31Z');
  const msgs=await Message.find({senderType:'bot', timestamp:{$gte:cut}, $or:[{text:/\$\s?\d/},{text:/\/r\//}]}).sort({timestamp:1}).lean();
  const priceCache={};
  const correctPrice=async(d)=>{ const k=key(d); if(k in priceCache) return priceCache[k]; const doc=await findProductInFamilies('x',CONF_FAM,d); let r=null; if(doc){const pi=await resolvePrice(doc); r={amount:pi.amount,source:pi.source,link:(doc.onlineStoreLinks||[])[0]&&doc.onlineStoreLinks[0].url,size:doc.size};} priceCache[k]=r; return r; };
  const findings=[];
  for(const m of msgs){
    const txt=m.text||'';
    const tDim=dimsFromText(txt), price=priceFromText(txt), code=codeFromText(txt);
    if(!price && !code) continue;
    // link target
    let linkUrl=null,lDim=null;
    if(code){ const cl=await ClickLog.findOne({$or:[{clickId:code},{shortCode:code}]}).select('originalUrl').lean(); linkUrl=cl&&cl.originalUrl; lDim=dimsFromUrl(linkUrl); }
    // correct price for the measure the bot stated (resolve in confeccionada)
    const cp = tDim ? await correctPrice(tDim) : null;
    const issues=[];
    if(tDim && lDim && key(tDim)!==key(lDim)) issues.push(`WRONG LINK: dijo ${key(tDim)} pero link va a ${key(lDim)}`);
    if(price!=null && cp && cp.amount!=null && Math.round(price)!==Math.round(cp.amount)) issues.push(`WRONG PRICE: citó $${price} pero ${key(tDim)} = $${cp.amount} (${cp.source})`);
    if(issues.length){
      const prev=await Message.findOne({psid:m.psid, senderType:'user', timestamp:{$lt:m.timestamp}}).sort({timestamp:-1}).select('text').lean();
      findings.push({psid:m.psid, at:m.timestamp.toISOString(), asked:(prev&&prev.text||'').slice(0,40), bot:txt.slice(0,110), tDim:key(tDim), price, lDim:key(lDim), correct:cp&&cp.amount, issues});
    }
  }
  console.log(`Audited ${msgs.length} messages. Flagged: ${findings.length}\n`);
  for(const f of findings){ console.log(`psid=${f.psid} ${f.at}`); console.log(`  cliente pidió: "${f.asked}"`); console.log(`  bot: "${f.bot}"`); f.issues.forEach(i=>console.log(`  ⚠️ ${i}`)); console.log(''); }
  await mongoose.connection.close();
})().catch(e=>{console.error(e);process.exit(1)});
