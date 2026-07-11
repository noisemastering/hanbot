require("dotenv").config();
const mongoose = require("mongoose");
(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const ClickLog = require("./models/ClickLog");
  const MLSale = require("./models/MLSale");
  const parseSize=t=>{const m=String(t||"").toLowerCase().replace(/(\d),(\d)/g,"$1.$2").match(/(\d{1,2}(?:\.\d)?)\s*m?\s*[x×]\s*(\d{1,2}(?:\.\d)?)/);if(!m)return null;const a=+m[1],b=+m[2];if(!(a>=1&&a<=16&&b>=1&&b<=16))return null;return `${Math.min(a,b)}x${Math.max(a,b)}`;};
  const isRollo=t=>/rollo|por\s*metro/i.test(String(t||""));

  // sales in memory: time, item sizes+ids
  const sales=(await MLSale.find({}).select("dateCreated items.title items.itemId").lean())
    .map(s=>({t:+new Date(s.dateCreated), items:(s.items||[]).map(it=>({sz:parseSize(it.title),id:String(it.itemId),rollo:isRollo(it.title)}))})).filter(s=>s.t).sort((a,b)=>a.t-b.t);
  const times=sales.map(s=>s.t); const lb=x=>{let lo=0,hi=times.length;while(lo<hi){const m=(lo+hi)>>1;times[m]<x?lo=m+1:hi=m}return lo};

  const SINCE=new Date("2026-06-01");
  const clicks=await ClickLog.find({ clickedAt:{$gte:SINCE}, productName:{$ne:null} }).select("productName mlItemId clickedAt").lean();
  const WIN=5*60000;
  const test=(shift)=>{
    let hits=0;
    for(const c of clicks){
      const sz=parseSize(c.productName); const mid=c.mlItemId?String(c.mlItemId):null; const rollo=isRollo(c.productName);
      if(!sz && !mid) continue;
      const t0=+new Date(c.clickedAt)+shift;
      let hit=false;
      for(let i=lb(t0);i<times.length && times[i]<=t0+WIN;i++){ // FORWARD only: [click, click+5min]
        if(sales[i].items.some(it=>(mid&&it.id===mid)||(sz&&it.sz===sz&&(rollo?it.rollo:!it.rollo)))){hit=true;break;}
      }
      if(hit)hits++;
    }
    return hits;
  };
  console.log("clicks tested:", clicks.length);
  console.log("REAL [click,+5m]:", test(0));
  console.log("PLACEBO +2h:     ", test(2*3600*1000));
  console.log("PLACEBO +5h:     ", test(5*3600*1000));
  console.log("PLACEBO +26h:    ", test(26*3600*1000));
  await mongoose.disconnect(); process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
