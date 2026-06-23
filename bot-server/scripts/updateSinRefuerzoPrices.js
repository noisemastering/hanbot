// scripts/updateSinRefuerzoPrices.js
// Confeccionada SIN refuerzo ("CORTE RASCHEL BEIGE 90%") = $41/m², Beige only.
// Overwrite existing prices to the list; create missing sizes as sellable but
// active:false. Never touch existing active status or mlPrice. Reversible.
//   node scripts/updateSinRefuerzoPrices.js          # dry run
//   node scripts/updateSinRefuerzoPrices.js --apply
const fs=require('fs'),path=require('path'),mongoose=require('mongoose'); require('dotenv').config();
const PF=require('../models/ProductFamily');
const FAM='6915377d0c0134ee807abf2a';
// size string -> price (original orientation from the list)
const LIST={'2x2m':164,'3x1m':123,'3x2m':246,'3x3m':369,'4x2m':328,'4x3m':492,'4x4m':656,'4x6m':984,'5x2m':410,'5x3m':615,'5x4m':820,'5x5m':1025,'5x6m':1230,'6x2m':492,'6x3m':738};
const norm=s=>{const n=String(s||'').toLowerCase().replace(/m/g,'').split(/[x×*]/).map(Number).filter(x=>!isNaN(x)); return n.length===2?n.sort((a,b)=>a-b).join('x'):null;};
const nameOf=s=>{const [w,l]=s.replace('m','').split('x'); return `${w} m x ${l} m`;};
const bfs=async(r)=>{const a=[],q=[r];let g=0;while(q.length&&g++<3000){const p=q.shift();const cs=await PF.find({parentId:p}).select('name size sellable active price parentId enabledDimensions').lean();for(const c of cs){a.push(c);q.push(String(c._id));}}return a;};
(async()=>{
  const apply=process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI);
  const all=await bfs(FAM);
  const leaves=all.filter(l=>l.sellable===true);
  // the "Rectangular" group = parent of existing size leaves
  const grpId=leaves.length?String(leaves[0].parentId):null;
  const dbByKey={}; for(const l of leaves){const k=norm(l.size); if(k)dbByKey[k]=l;}
  const ed=(leaves.find(l=>Array.isArray(l.enabledDimensions))||{}).enabledDimensions||['width','length'];
  const updates=[], creates=[], backup=[];
  for(const [size,price] of Object.entries(LIST)){
    const k=norm(size); const ex=dbByKey[k];
    if(ex){ if(ex.price!==price){ updates.push({_id:ex._id,from:ex.price,to:price,size}); backup.push({_id:ex._id,price:ex.price}); } }
    else { creates.push({parentId:grpId,name:nameOf(size),size,price,sellable:true,active:false,enabledDimensions:ed}); }
  }
  console.log('Group (Rectangular) id:', grpId);
  console.log(`Price overwrites: ${updates.length}`); updates.forEach(u=>console.log(`   ${u.size}: $${u.from} → $${u.to}`));
  console.log(`Creates (sellable, active:false): ${creates.length}`); creates.forEach(c=>console.log(`   ${c.size} "${c.name}" $${c.price}`));
  if(!apply){ console.log('\n(DRY RUN — --apply to write + back up.)'); await mongoose.connection.close(); return; }
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  fs.writeFileSync(path.join(__dirname,`_sinRefBackup_${stamp}.json`),JSON.stringify(backup,null,2));
  for(const u of updates) await PF.findByIdAndUpdate(u._id,{$set:{price:u.to}});
  const created=[]; for(const c of creates){ const d=await PF.create(c); created.push(String(d._id)); }
  fs.writeFileSync(path.join(__dirname,`_sinRefCreated_${stamp}.json`),JSON.stringify(created,null,2));
  console.log(`\n✅ Updated ${updates.length} prices, created ${created.length} leaves. Backups written.`);
  await mongoose.connection.close();
})().catch(e=>{console.error(e);process.exit(1)});
