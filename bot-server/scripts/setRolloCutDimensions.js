// scripts/setRolloCutDimensions.js
// Set attributes {width,length} on the rollo cut nodes I created (from the backup
// of created ids), parsed from each node's own size — matching the GC convention.
const fs=require('fs'),path=require('path'),mongoose=require('mongoose'); require('dotenv').config();
const PF=require('../models/ProductFamily');
const parse=s=>{const n=String(s||'').toLowerCase().replace(/m/g,'').split(/[x×*]/).map(x=>x.trim()).filter(Boolean); return n.length===2?{width:n[0],length:n[1]}:null;};
(async()=>{
  const apply=process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI);
  const f=fs.readdirSync(__dirname).filter(x=>x.startsWith('_rolloCutCreated_')).sort().pop();
  const ids=JSON.parse(fs.readFileSync(path.join(__dirname,f),'utf8'));
  console.log('Created-node backup:',f,'| nodes:',ids.length);
  let plan=[];
  for(const id of ids){ const d=await PF.findById(id).select('name size attributes').lean(); if(!d)continue; const a=parse(d.size); if(!a){console.log('  skip (no 2D size):',d.name,d.size);continue;} if(JSON.stringify(d.attributes)===JSON.stringify(a))continue; plan.push({id,name:d.name,size:d.size,a}); }
  console.log(`Will set attributes on ${plan.length} nodes (e.g. ${plan.slice(0,3).map(p=>`${p.size}→${JSON.stringify(p.a)}`).join(', ')})`);
  if(!apply){ console.log('(DRY RUN — --apply to write.)'); await mongoose.connection.close(); return; }
  for(const p of plan) await PF.findByIdAndUpdate(p.id,{$set:{attributes:p.a}});
  console.log(`✅ Set attributes {width,length} on ${plan.length} rollo cut nodes.`);
  await mongoose.connection.close();
})().catch(e=>{console.error(e);process.exit(1)});
