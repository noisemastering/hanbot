// businessInfoManager.js
const mongoose = require("mongoose");

const businessInfoSchema = new mongoose.Schema({
  _id: String,
  name: String,
  phones: [String],
  hours: String,
  address: String,
  catalog: {
    url: String,
    publicId: String,
    name: String,
    uploadedAt: Date
  },
  updatedAt: Date
});

const BusinessInfo = mongoose.model("BusinessInfo", businessInfoSchema);

async function getBusinessInfo() {
  const info = await BusinessInfo.findById("hanlob-info");
  if (!info) {
    console.warn("⚠️ No se encontró información de negocio en la base de datos.");
    return {
      name: "Hanlob",
      phones: ["55 0000 0000"],
      hours: "Lunes a Viernes de 9:00 a 18:00",
      address: "CDMX",
    };
  }
  return info.toObject();
}

module.exports = { getBusinessInfo };
