// scripts/setRollsPlusIva.js
// Set priceExcludesTax=true on ROLL leaves (malla sombra raschel rollos + ground
// cover rollos) so the bot quotes them "+ IVA". Everything else stays false
// (default). Borde and confeccionada are NOT touched. Reversible (backup).
const fs=require('fs'),path=require('path'),mongoose=require('mongoose'); require('dotenv').config();
const PF=require('../models/ProductFamily');
const MS='68f6c372bfaca6a28884afd7';   // Malla Sombra Raschel (rollos live under a "Rollo" node)
const GC='6939c512b7f2dfa6d9161f0a';    // Ground Cover (all rollos)
(async()=>{
  const apply=process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI);
  const targets=new Map(); // id -> label
  // Malla Sombra Raschel: only leaves whose ancestry passes through a "Rollo" node
  const walkMS=async(id,underRollo)=>{
    const kids=await PF.find({parentId:id}).select('name size sellable priceExcludesTax').lean();
    for(const k of kids){
      const ur=underRollo || /(^|\b)rollo\b/i.test(k.name||'');
      if(ur && k.sellable===true) targets.set(String(k._id), `MS ${k.name}/${k.size}`);
      await walkMS(k._id, ur);
    }
  };
  await walkMS(MS,false);
  // Ground Cover: all sellable leaves are rollos
  const walkGC=async(id)=>{ const kids=await PF.find({parentId:id}).select('name size sellable').lean(); for(const k of kids){ if(k.sellable===true) targets.set(String(k._id),`GC ${k.name}/${k.size}`); await walkGC(k._id);} };
  await walkGC(GC);
  // only those not already true
  const docs=await PF.find({_id:{$in:[...targets.keys()]}}).select('priceExcludesTax').lean();
  const need=docs.filter(d=>d.priceExcludesTax!==true).map(d=>String(d._id));
  console.log(`Roll leaves found: ${targets.size} | need set to +IVA: ${need.length}`);
  console.log('  sample:', [...targets.values()].slice(0,6).join(' | '));
  if(!apply){ console.log('\n(DRY RUN — --apply to write + back up.)'); await mongoose.connection.close(); return; }
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  fs.writeFileSync(path.join(__dirname,`_plusIvaBackup_${stamp}.json`),JSON.stringify(need,null,2));
  const res=await PF.updateMany({_id:{$in:need}},{$set:{priceExcludesTax:true}});
  console.log(`\n✅ Set priceExcludesTax=true on ${res.modifiedCount} roll leaves. Backup: _plusIvaBackup_${stamp}.json`);
  await mongoose.connection.close();
})().catch(e=>{console.error(e);process.exit(1)});
