const mongoose=require('mongoose');
require('dotenv').config({ path: __dirname + '/../.env' });
const PF=require('../models/ProductFamily');
const fs=require('fs');
const rows=require('/tmp/_links.json'); // ALL 229 rows
const normSize=s=>String(s||'').toLowerCase().replace(/[^0-9x.]/g,'');
const normColor=s=>{const t=String(s||'').toLowerCase();if(/negro/.test(t))return'negro';if(/blanco/.test(t))return'blanco';if(/verde/.test(t))return'verde';if(/beige|biege/.test(t))return'beige';return'';};
const num=p=>{const n=parseFloat(String(p||'').replace(/[^0-9.]/g,''));return Number.isFinite(n)&&n>0?n:null;};
function cat(row){const p=(row.producto||'').toLowerCase();const shade=(p.match(/(\d+)\s*%/)||[])[1]||null;
  if(/borde/.test(p))return{kind:'borde',thick:/grueso/.test(p)?'grueso':/delgado/.test(p)?'delgado':null};
  if(/reforzad/.test(p))return{kind:'attr',hint:/refuerzo|reforzad/,anti:/sin refuerzo/,tri:/triangular/.test(p)};
  if(/corte raschel|argolla/.test(p))return{kind:'attr',hint:/sin refuerzo|raschel/,anti:/con refuerzo|ground/,shade};
  if(/ground cover/.test(p))return{kind:'attr',hint:/ground cover/,anti:null};
  if(/raschel|^\s*\d+\s*%|color (beige|negro|verde)/.test(p))return{kind:'attr',hint:/raschel/,anti:/ground cover|confeccionada con|sin refuerzo/,shade};
  return{kind:'comp',tok:(p.match(/lazo|kit|ojillo|sujetador|cinta|cord/)||[])[0]};}
(async()=>{
  await mongoose.connect(process.env.MONGODB_URI);
  const all=await PF.find({}).select('name parentId size attributes price mlPrice sellable onlineStoreLinks active').lean();
  const byId=new Map(all.map(d=>[String(d._id),d]));
  const pathOf=d=>{let n=[],c=d;for(let i=0;i<8&&c;i++){n.unshift(c.name);c=c.parentId?byId.get(String(c.parentId)):null;}return n.join(' > ');};
  for(const d of all){d._p=pathOf(d).toLowerCase();d._sz=normSize(d.size||(d.attributes?`${d.attributes.width||''}x${d.attributes.length||''}`:''));d._c=normColor(d.name);d._nums=(d._p.match(/\d+/g)||[]);}
  const sell=all.filter(d=>d.sellable===true);
  const backup=[]; let priced=0, linked=0, unmatched=0, aB=0,aA=0; const unm=[];
  for(const r of rows){
    const price=num(r.precio); if(price==null) continue;
    const c=cat(r),sz=normSize(r.medida),col=normColor(r.color),lenNum=(r.medida.match(/\d+/)||[])[0];
    let cd=sell.filter(d=>{
      if(c.kind==='borde'){if(!/borde/.test(d._p))return false;if(c.thick&&!new RegExp(c.thick).test(d._p))return false;return lenNum?d._nums.includes(lenNum):true;}
      if(c.kind==='comp'){return c.tok?new RegExp(c.tok).test(d._p):false;}
      if(c.hint&&!c.hint.test(d._p))return false; if(c.anti&&c.anti.test(d._p))return false;
      if(c.shade&&!new RegExp(`\\b${c.shade}\\s*%`).test(d._p))return false;
      if(c.tri!==undefined){if(c.tri&&!/triangular/.test(d._p))return false;if(!c.tri&&/triangular/.test(d._p))return false;}
      if(sz&&d._sz!==sz)return false; if(col&&d._c&&d._c!==col)return false; return true;});
    if(cd.length!==1){ unmatched++; if(unm.length<8)unm.push(`${r.producto}|${r.medida}|${r.color}(${cd.length})`); continue; }
    const d=cd[0];
    backup.push({id:d._id,name:d.name,price:d.price,mlPrice:d.mlPrice,onlineStoreLinks:d.onlineStoreLinks});
    if(d.active)aB++;
    const set={price:price, mlPrice:price};
    if(/mercadolibre/i.test(r.link||'')){ set.onlineStoreLinks=[{url:r.link,isPreferred:true,store:'Mercado Libre'}]; linked++; }
    await PF.updateOne({_id:d._id},{$set:set});
    const a=byId.get(String(d._id)); if(a&&a.active)aA++;
    priced++;
  }
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  fs.writeFileSync(`${__dirname}/_allDocApplyBackup_${stamp}.json`, JSON.stringify(backup,null,1));
  console.log(`backup → scripts/_allDocApplyBackup_${stamp}.json (${backup.length})`);
  console.log(`ALL doc prices → DB: priced ${priced} (of ${rows.filter(r=>num(r.precio)!=null).length} priced rows) | links (re)set ${linked} | unmatched ${unmatched}`);
  console.log(`active unchanged: before=${aB} after=${aA} ${aB===aA?'✓':'⚠'}`);
  if(unm.length) console.log('unmatched samples:', unm.join(' || '));
  // spot checks
  for(const [nm,sz] of [['Color Beige','6x4m'],['Color Beige','2x2m']]){
    const s=await PF.findOne({name:new RegExp(nm,'i'),size:sz}).select('price mlPrice onlineStoreLinks').lean();
    if(s) console.log(`  spot ${sz}: price=$${s.price} mlPrice=$${s.mlPrice} link=${(s.onlineStoreLinks||[]).length?'Y':'N'}`);
  }
  await mongoose.connection.close();
})().catch(e=>{console.error(e);process.exit(1)});
