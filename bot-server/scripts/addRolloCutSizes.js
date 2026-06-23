// scripts/addRolloCutSizes.js
// Add smaller Malla Sombra Raschel ROLL cut sizes under each shade %:
//   {shade}% > Rollo > Medida {WxL} > Color {Beige|Negro}
// No prices given → price = area × (refPrice/refArea) of that shade's existing roll,
// so a same-area cut equals the existing same-area roll. New: sellable:true, active:false.
const fs=require('fs'),path=require('path'),mongoose=require('mongoose'); require('dotenv').config();
const PF=require('../models/ProductFamily');
const ROOT='68f6c372bfaca6a28884afd7';
// shade -> { rate from ref roll, items: [size, colors[]] }
const REF={ '90':2904.69/200, '80':1848.01/200, '70':1631.02/200, '50':2712.93/420, '35':1841.12/420 };
const ITEMS={
  '90':{colors:['Beige','Negro'], sizes:['2x10m','2x15m','2x25m','2x50m','4x10m','4x15m','4x25m','4x50m']},
  '80':{colors:['Beige','Negro'], sizes:['4x10m','4x15m','4x25m','4x50m']},
  '70':{colors:['Beige','Negro'], sizes:['4x10m','4x15m','4x25m','4x50m']},
  '50':{colors:['Negro'], sizes:['4x10m','4x25m','4x50m']},
  '35':{colors:['Negro'], sizes:['4x14m','4x25m','4x50m']},
};
const area=s=>{const n=s.replace(/m/g,'').split('x').map(parseFloat); return n[0]*n[1];};
const norm=s=>String(s||'').toLowerCase().replace(/m/g,'').split(/[x×*]/).map(parseFloat).filter(x=>!isNaN(x)).sort((a,b)=>a-b).join('x');
const r2=n=>Math.round(n*100)/100;
const findChild=async(pid,rx)=>{ const ks=await PF.find({parentId:pid}).select('name').lean(); return ks.find(k=>rx.test(k.name||'')); };
const bfs=async(r)=>{const a=[],q=[r];let g=0;while(q.length&&g++<3000){const p=q.shift();const cs=await PF.find({parentId:p}).select('name size sellable parentId').lean();for(const c of cs){a.push(c);q.push(String(c._id));}}return a;};
(async()=>{
  const apply=process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI);
  const shadeNodes=await PF.find({name:/^\s*\d+\s*%/}).select('name parentId').lean();
  const plan=[]; const created=[];
  for(const sh of Object.keys(ITEMS)){
    const node=shadeNodes.find(n=>new RegExp(`^\\s*${sh}\\s*%`).test(n.name));
    if(!node){ console.log(`⚠️ shade ${sh}% node not found`); continue; }
    const rollo=await findChild(node._id, /rollo/i);
    if(!rollo){ console.log(`⚠️ ${sh}% has no "Rollo" child`); continue; }
    const existing=await bfs(String(rollo._id));
    const have=new Set(existing.filter(l=>/beige|negro|verde/i.test(l.name)).map(l=>`${norm(l.size)}|${/negro/i.test(l.name)?'Negro':/beige/i.test(l.name)?'Beige':'Verde'}`));
    for(const size of ITEMS[sh].sizes){
      const price=r2(area(size)*REF[sh]);
      const needed=ITEMS[sh].colors.filter(c=>!have.has(`${norm(size)}|${c}`));
      if(needed.length) plan.push({sh, rolloId:String(rollo._id), rolloName:rollo.name, size, price, colors:needed});
    }
  }
  console.log(`Plan: ${plan.length} size-groups`);
  plan.forEach(p=>console.log(`  ${p.sh}% Medida ${p.size} $${p.price} → ${p.colors.join(', ')}`));
  if(!apply){ console.log('\n(DRY RUN — --apply to create.)'); await mongoose.connection.close(); return; }
  for(const p of plan){
    const [w,l]=p.size.replace('m','').split('x');
    const grp=await PF.create({parentId:p.rolloId, name:`Medida ${w}x${l}`, size:p.size, sellable:false, active:false, enabledDimensions:['width','length']});
    created.push(String(grp._id));
    for(const c of p.colors){
      const leaf=await PF.create({parentId:String(grp._id), name:`Color ${c}`, size:p.size, price:p.price, sellable:true, active:false, enabledDimensions:['width','length']});
      created.push(String(leaf._id));
    }
  }
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  fs.writeFileSync(path.join(__dirname,`_rolloCutCreated_${stamp}.json`),JSON.stringify(created,null,2));
  console.log(`\n✅ Created ${created.length} nodes. Backup: _rolloCutCreated_${stamp}.json`);
  await mongoose.connection.close();
})().catch(e=>{console.error(e);process.exit(1)});
