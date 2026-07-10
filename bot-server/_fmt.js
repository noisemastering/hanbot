require("dotenv").config();
const m=require("mongoose");
const ClickLog=require("./models/ClickLog");const User=require("./models/User");
(async()=>{
  await m.connect(process.env.MONGODB_URI||process.env.MONGO_URI);
  // sample click psids that have NO direct User.psid match
  const psids=await ClickLog.distinct("psid",{clicked:true,productId:{$ne:null}});
  console.log("sample raw ClickLog.psid values:");
  for(const p of psids.slice(0,8)) console.log("   ",JSON.stringify(p));
  // sample User keys
  const us=await User.find({}).select("psid unifiedId channel location.zipcode").limit(8).lean();
  console.log("\nsample User psid / unifiedId / channel:");
  for(const u of us) console.log("   psid=",JSON.stringify(u.psid)," unifiedId=",JSON.stringify(u.unifiedId)," ch=",u.channel," zip=",u.location&&u.location.zipcode);
  // Try alt matching on the 'no user' set: unifiedId equals psid, or fb:psid, or wa:psid
  let hitUnified=0, hitFbPref=0, hitWaPref=0, checked=0;
  for(const p of psids.slice(0,1500)){
    checked++;
    const direct=await User.findOne({psid:p}).select("_id").lean();
    if(direct) continue;
    if(await User.findOne({unifiedId:p}).select("_id").lean()){hitUnified++;continue;}
    if(await User.findOne({unifiedId:`fb:${p}`}).select("_id").lean()){hitFbPref++;continue;}
    if(await User.findOne({unifiedId:`wa:${p}`}).select("_id").lean()){hitWaPref++;continue;}
  }
  console.log(`\nof first ${checked} psids w/o direct psid match, alt-key recoveries:`);
  console.log(`  unifiedId==psid: ${hitUnified} | unifiedId==fb:psid: ${hitFbPref} | unifiedId==wa:psid: ${hitWaPref}`);
  // total User count + how many users have a zip
  const totU=await User.countDocuments();
  const zipU=await User.countDocuments({"location.zipcode":{$nin:[null,""]}});
  console.log(`\nUsers total: ${totU} | with zipcode: ${zipU}`);
  await m.connection.close();
})().catch(e=>{console.error(e.message);process.exit(1)});
