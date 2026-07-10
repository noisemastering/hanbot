const mongoose=require('mongoose');
require('dotenv').config({ path: __dirname + '/../.env' });
const PF=require('../models/ProductFamily');
const fs=require('fs');
const {APPLY,priceDiff}=require('/tmp/_planall.json');
// apply = all price-verified + price-diff rows that have NO existing link (additive)
const additive=priceDiff.filter(x=>!x.existing);
const held=priceDiff.filter(x=>x.existing); // existing link + price mismatch → hold for review
const toApply=[...APPLY, ...additive];
(async()=>{
  await mongoose.connect(process.env.MONGODB_URI);
  const backup=[];
  for(const p of toApply){ const d=await PF.findById(p.id).select('name onlineStoreLinks active price').lean(); backup.push({id:p.id,name:d?.name,onlineStoreLinks:d?.onlineStoreLinks||[]}); }
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  fs.writeFileSync(`${__dirname}/_allLinksBackup_${stamp}.json`, JSON.stringify(backup,null,1));
  let ok=0, aB=0, aA=0;
  for(const p of toApply){
    const b=await PF.findById(p.id).select('active').lean(); if(b?.active)aB++;
    await PF.updateOne({_id:p.id},{$set:{onlineStoreLinks:[{url:p.link,isPreferred:true,store:"Mercado Libre"}]}});
    const a=await PF.findById(p.id).select('active onlineStoreLinks').lean(); if(a?.active)aA++;
    if((a.onlineStoreLinks||[]).some(x=>x.url===p.link))ok++;
  }
  console.log(`backup → scripts/_allLinksBackup_${stamp}.json`);
  console.log(`APPLIED ${ok}/${toApply.length}  (price-verified ${APPLY.length} + additive-new ${additive.length})`);
  console.log(`active unchanged: before=${aB} after=${aA} ${aB===aA?'✓':'⚠'}`);
  console.log(`HELD for review (existing link + price mismatch): ${held.length}`);
  fs.writeFileSync('/tmp/_held.json', JSON.stringify(held));
  await mongoose.connection.close();
})().catch(e=>{console.error(e);process.exit(1)});
