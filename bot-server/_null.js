require("dotenv").config();
const mongoose = require("mongoose");
const { convoIdentity, buildContext } = require("./utils/convoSaleMatcher");
(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const Conversation = require("./models/Conversation");
  const MLSale = require("./models/MLSale");
  const ctx = await buildContext();
  const parseSize=t=>{const m=String(t||"").toLowerCase().replace(/(\d),(\d)/g,"$1.$2").match(/(\d{1,2}(?:\.\d)?)\s*m?\s*[x×]\s*(\d{1,2}(?:\.\d)?)/);if(!m)return null;const a=+m[1],b=+m[2];if(!(a>=1&&a<=16&&b>=1&&b<=16))return null;return `${Math.min(a,b)}x${Math.max(a,b)}`;};
  const isRollo=t=>/rollo|por\s*metro/i.test(String(t||""));
  const FIELDS="psid itemsDiscussed productInterest poiRootName extractedName productSpecs city zipCode zipcode customOrderZipcode humanSalesZipcode leadData crmName poiRootId productFamilyId aiIdentity adMainProductId lastMessageAt createdAt";
  const SINCE=new Date("2026-06-01");
  // preload ALL sales once, sort by time (avoid per-convo DB query)
  const sales = (await MLSale.find({}).select("dateCreated items.title buyer.id buyer.nickname _id").lean())
    .map(s=>({t:+new Date(s.dateCreated), b:String((s.buyer&&(s.buyer.id||s.buyer.nickname))||s._id), sizes:(s.items||[]).map(it=>({sz:parseSize(it.title),rollo:isRollo(it.title)}))})).filter(s=>s.t).sort((a,b)=>a.t-b.t);
  const times=sales.map(s=>s.t); const lb=x=>{let lo=0,hi=times.length;while(lo<hi){const m=(lo+hi)>>1;times[m]<x?lo=m+1:hi=m}return lo};
  const convos = await Conversation.find({ $or:[{lastMessageAt:{$gte:SINCE}},{createdAt:{$gte:SINCE}}] }).select(FIELDS).lean();
  const WIN=5*60000;
  const test = (shiftMs) => {
    let links=0;
    for (const c of convos) {
      const id = convoIdentity(c, ctx);
      if (id.zip||id.city||id.names.length||!id.basketSizes.size) continue;
      const ab = c.lastMessageAt?+new Date(c.lastMessageAt):(c.createdAt?+new Date(c.createdAt):null); if(!ab)continue;
      const anchor=ab+shiftMs;
      const buyers=new Set();
      for(let i=lb(anchor-WIN);i<times.length&&times[i]<=anchor+WIN;i++){
        if(sales[i].sizes.some(x=>x.sz&&id.basketSizes.has(x.sz)&&(id.convoIsRollo?x.rollo:!x.rollo))) buyers.add(sales[i].b);
      }
      if(buyers.size===1) links++;
    }
    return links;
  };
  console.log("REAL (0h):   ", test(0));
  console.log("PLACEBO +2h: ", test(2*3600*1000));
  console.log("PLACEBO +5h: ", test(5*3600*1000));
  console.log("PLACEBO +37h:", test(37*3600*1000));
  await mongoose.disconnect(); process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
