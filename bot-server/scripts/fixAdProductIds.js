const mongoose = require('mongoose');
require('dotenv').config();

async function fixAdProductIds() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const Ad = mongoose.model('Ad', require('../models/Ad').schema);

    // Get all ads
    const ads = await Ad.find({});
    console.log(`Found ${ads.length} ads to check`);

    let fixed = 0;
    for (const ad of ads) {
      if (ad.productIds && ad.productIds.length > 0) {
        // Convert string IDs to ObjectId
        const convertedIds = ad.productIds.map(id => {
          if (typeof id === 'string') {
            return new mongoose.Types.ObjectId(id);
          }
          return id;
        });

        // Update the ad
        await Ad.findByIdAndUpdate(ad._id, {
          productIds: convertedIds
        });

        console.log(`✅ Fixed ad ${ad._id} (${ad.name}): ${ad.productIds.length} products`);
        fixed++;
      }
    }

    console.log(`\n✅ Fixed ${fixed} ads`);
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

fixAdProductIds();
