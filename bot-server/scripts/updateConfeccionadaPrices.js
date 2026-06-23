// scripts/updateConfeccionadaPrices.js
// Overwrite confeccionada (Reforzada) prices to the $55/m² list, create the
// missing 3x2 color leaves (sellable, active:false). Never touches active status
// of existing products, never touches mlPrice (live ML stays paramount at quote
// time; these prices are the inventory/list fallback). Reversible (backup).
//   node scripts/updateConfeccionadaPrices.js          # dry run
//   node scripts/updateConfeccionadaPrices.js --apply
const fs=require('fs'),path=require('path'),mongoose=require('mongoose'); require('dotenv').config();
const PF=require('../models/ProductFamily');
const RECT={'2x10':1100,'2x2':220,'2x4':440,'2x7':770,'2x8':880,'3x2':330,'3x3':495,'3x7':1155,'3x8':1320,'4x10':2200,'4x11':2420,'3x4':660,'4x4':880,'4x7':1540,'4x8':1760,'4x9':1980,'5x10':2750,'5x11':3025,'2x5':550,'3x5':825,'4x5':1100,'5x5':1375,'5x7':1925,'5x8':2200,'5x9':2475,'6x10':3300,'2x6':660,'3x6':990,'4x6':1320,'5x6':1650,'6x6':1980,'6x7':2310,'6x8':2640,'6x9':2970,'7x10':3850,'7x7':2695,'7x8':3080,'7x9':3465,'8x8':3520};
const TRI={'2x2x2':569,'3x3x3':842.5,'4x4x4':975,'5x5x5':1398};
const RECT_FAM='6942d85ba539ce7f9f28429b', TRI_FAM='691537aa0c0134ee807abf3a';
const norm=s=>String(s||'').toLowerCase().replace(/m/g,'').split(/[x×*]/).map(Number).filter(n=>!isNaN(n)).sort((a,b)=>a-b).join('x');
const col=n=>/negro/i.test(n)?'N':/verde/i.test(n)?'V':/beige/i.test(n)?'B':'?';
const bfs=async(root)=>{const all=[],q=[root];let g=0;while(q.length&&g++<3000){const p=q.shift();const cs=await PF.find({parentId:p}).select('name size sellable active price parentId enabledDimensions').lean();for(const c of cs){all.push(c);q.push(String(c._id));}}return all;};
(async()=>{
  const apply=process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI);
  const rectAll=await bfs(RECT_FAM), triAll=await bfs(TRI_FAM);
  const updates=[], creates=[], backup=[];
  // Rectangular price overwrites
  for(const l of rectAll){ const c=col(l.name); if(c==='?')continue; const k=norm(l.size); if(RECT[k]!=null && l.price!==RECT[k]){ updates.push({_id:l._id,from:l.price,to:RECT[k],what:`${k} ${c}`}); backup.push({_id:l._id,price:l.price}); } }
  // Triangular price overwrites
  for(const l of triAll){ const k=norm(l.size); if(TRI[k]!=null && l.price!==TRI[k]){ updates.push({_id:l._id,from:l.price,to:TRI[k],what:`tri ${k}`}); backup.push({_id:l._id,price:l.price}); } }
  // Missing 3x2 color leaves
  const grp32=rectAll.find(n=>norm(n.size)==='2x3' && n.sellable!==true) || rectAll.find(n=>norm(n.size)==='2x3' && /3\s*m?\s*x\s*2/i.test(n.name));
  // safer: the size-group is the parent of any 3x2 leaf, or a direct child of family with size 3x2m and sellable:false
  const grp=rectAll.find(n=>norm(n.size)==='2x3' && n.sellable===false) || grp32;
  const sampleLeaf=rectAll.find(l=>col(l.name)!=='?' && Array.isArray(l.enabledDimensions));
  const ed=sampleLeaf?sampleLeaf.enabledDimensions:['width','length'];
  if(grp){ for(const [c,name] of [['B','Color Beige'],['N','Color Negro'],['V','Color Verde']]){ creates.push({parentId:String(grp._id),name,size:'3x2m',price:330,sellable:true,active:false,enabledDimensions:ed}); } }
  else console.log('⚠️ 3x2 size-group not found — skipping creates');

  console.log(`Price overwrites: ${updates.length}`);
  updates.slice(0,6).forEach(u=>console.log(`   ${u.what}: $${u.from} → $${u.to}`));
  console.log(`Creates (3x2): ${creates.length} (sellable:true, active:false) under group ${grp?grp._id:'-'}`);
  if(!apply){ console.log('\n(DRY RUN — re-run with --apply to write + back up.)'); await mongoose.connection.close(); return; }
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  fs.writeFileSync(path.join(__dirname,`_priceBackup_${stamp}.json`),JSON.stringify(backup,null,2));
  for(const u of updates) await PF.findByIdAndUpdate(u._id,{$set:{price:u.to}});
  const created=[]; for(const c of creates){ const doc=await PF.create(c); created.push(String(doc._id)); }
  fs.writeFileSync(path.join(__dirname,`_createdLeaves_${stamp}.json`),JSON.stringify(created,null,2));
  console.log(`\n✅ Updated ${updates.length} prices, created ${created.length} leaves. Backups: _priceBackup_${stamp}.json / _createdLeaves_${stamp}.json`);
  await mongoose.connection.close();
})().catch(e=>{console.error(e);process.exit(1)});
