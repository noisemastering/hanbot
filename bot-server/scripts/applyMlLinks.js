const mongoose=require('mongoose');
require('dotenv').config({ path: __dirname + '/../.env' });
const PF=require('../models/ProductFamily');
const fs=require('fs');
const plan=require('/tmp/_matchplan.json');
(async()=>{
  await mongoose.connect(process.env.MONGODB_URI);
  // backup current onlineStoreLinks for these leaves
  const backup=[];
  for(const p of plan){
    const d=await PF.findById(p.id).select('name onlineStoreLinks active').lean();
    backup.push({id:p.id, name:d?.name, onlineStoreLinks:d?.onlineStoreLinks||[]});
  }
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  fs.writeFileSync(`${__dirname}/_linksBackup_${stamp}.json`, JSON.stringify(backup,null,1));
  console.log(`backup → scripts/_linksBackup_${stamp}.json (${backup.length})`);

  let updated=0, activeBefore=0, activeAfter=0;
  for(const p of plan){
    const before=await PF.findById(p.id).select('active').lean();
    if(before?.active) activeBefore++;
    // set the ML link; do NOT touch active/price/sellable
    await PF.updateOne({_id:p.id}, {$set:{ onlineStoreLinks:[{url:p.link, isPreferred:true, store:"Mercado Libre"}] }});
    const after=await PF.findById(p.id).select('active onlineStoreLinks').lean();
    if(after?.active) activeAfter++;
    if((after.onlineStoreLinks||[]).some(x=>x.url===p.link)) updated++;
  }
  console.log(`updated ${updated}/${plan.length} | active unchanged: before=${activeBefore} after=${activeAfter} ${activeBefore===activeAfter?'✓':'⚠CHANGED'}`);
  await mongoose.connection.close();
})().catch(e=>{console.error(e);process.exit(1)});
