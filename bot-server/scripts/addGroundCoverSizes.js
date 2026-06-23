// scripts/addGroundCoverSizes.js
// Add smaller Ground Cover roll sizes (Negro/Blanco) under the Ground Cover family
// (6939c512), mirroring the existing "Rollo de WxL m" group → color-leaf structure.
// New items: sellable:true, active:false (per standing rule). Idempotent + reversible.
//   node scripts/addGroundCoverSizes.js          # dry run
//   node scripts/addGroundCoverSizes.js --apply
const fs=require('fs'),path=require('path'),mongoose=require('mongoose'); require('dotenv').config();
const PF=require('../models/ProductFamily');
const GC='6939c512b7f2dfa6d9161f0a';
const SIZES=[['2x10m',510],['2x25m',1275],['2x50m',2550],['4x10m',1020],['4x25m',2550],['4x50m',5100]];
const COLORS=['Negro','Blanco'];
const norm=s=>String(s||'').toLowerCase().replace(/m/g,'').split(/[x×*]/).map(Number).filter(x=>!isNaN(x)).sort((a,b)=>a-b).join('x');
const col=n=>/negro/i.test(n)?'Negro':/blanco/i.test(n)?'Blanco':null;
const grpName=s=>{const[w,l]=s.replace('m','').split('x'); return `Rollo de ${w}x${l} m`;};
const bfs=async(r)=>{const a=[],q=[r];let g=0;while(q.length&&g++<2000){const p=q.shift();const cs=await PF.find({parentId:p}).select('name size sellable parentId').lean();for(const c of cs){a.push(c);q.push(String(c._id));}}return a;};
(async()=>{
  const apply=process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI);
  const existing=await bfs(GC);
  const have=new Set(); for(const l of existing){ const c=col(l.name); if(c) have.add(`${norm(l.size)}|${c}`); }
  const plan=[];
  for(const [size,price] of SIZES){
    const k=norm(size);
    const needed=COLORS.filter(c=>!have.has(`${k}|${c}`));
    if(needed.length) plan.push({size,price,grpName:grpName(size),colors:needed});
  }
  console.log('New size-groups to create:', plan.length);
  plan.forEach(p=>console.log(`  "${p.grpName}" (${p.size}) $${p.price} → ${p.colors.join(', ')}`));
  if(!apply){ console.log('\n(DRY RUN — --apply to create.)'); await mongoose.connection.close(); return; }
  const created=[];
  for(const p of plan){
    const grp=await PF.create({parentId:GC, name:p.grpName, size:p.size, sellable:false, active:false, enabledDimensions:['width','length']});
    created.push(String(grp._id));
    for(const c of p.colors){
      const leaf=await PF.create({parentId:String(grp._id), name:c, size:p.size, price:p.price, sellable:true, active:false, enabledDimensions:['width','length']});
      created.push(String(leaf._id));
    }
  }
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  fs.writeFileSync(path.join(__dirname,`_gcCreated_${stamp}.json`),JSON.stringify(created,null,2));
  console.log(`\n✅ Created ${created.length} nodes (${plan.length} groups + leaves). Backup: _gcCreated_${stamp}.json`);
  await mongoose.connection.close();
})().catch(e=>{console.error(e);process.exit(1)});
