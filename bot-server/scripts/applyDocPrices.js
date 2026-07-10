const mongoose=require('mongoose');
require('dotenv').config({ path: __dirname + '/../.env' });
const PF=require('../models/ProductFamily');
const fs=require('fs');
const { priceDiff }=require('/tmp/_planall.json'); // leaves where doc price != DB price
(async()=>{
  await mongoose.connect(process.env.MONGODB_URI);
  const backup=[]; let updated=0, aB=0, aA=0;
  for(const p of priceDiff){
    const d=await PF.findById(p.id).select('name price mlPrice active').lean();
    if(!d) continue;
    backup.push({id:p.id,name:d.name,price:d.price,mlPrice:d.mlPrice});
    if(d.active)aB++;
    // DB price = document price. Set mlPrice too so the bot quotes it cleanly when
    // live ML is unavailable (and avoids the inv<syncedML handoff trap). A live ML
    // discount still overrides at quote time, per the hierarchy.
    await PF.updateOne({_id:p.id},{$set:{ price:p.docPrice, mlPrice:p.docPrice }});
    const a=await PF.findById(p.id).select('active').lean(); if(a?.active)aA++;
    updated++;
  }
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  fs.writeFileSync(`${__dirname}/_docPricesBackup_${stamp}.json`, JSON.stringify(backup,null,1));
  console.log(`backup → scripts/_docPricesBackup_${stamp}.json (${backup.length})`);
  console.log(`prices set to document value: ${updated}/${priceDiff.length}`);
  console.log(`active unchanged: before=${aB} after=${aA} ${aB===aA?'✓':'⚠'}`);
  await mongoose.connection.close();
})().catch(e=>{console.error(e);process.exit(1)});
