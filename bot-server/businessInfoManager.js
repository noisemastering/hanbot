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

// Central constants — change here, updates everywhere
const MAPS_URL = "https://www.google.com/maps/place/Malla+Sombra+Hanlob/@20.5946169,-100.4630917,17z";
const STORE_ADDRESS = "Calle Loma de San Gremal No. 108, bodega 73, Microparque Industrial Navex Park, Col. Ejido Santa María Magdalena, C.P. 76137, Santiago de Querétaro, Qro.";

async function getBusinessInfo() {
  const info = await BusinessInfo.findById("hanlob-info");
  if (!info) {
    console.warn("⚠️ No se encontró información de negocio en la base de datos.");
    return {
      name: "Hanlob",
      phones: ["55 0000 0000"],
      hours: "Lunes a Viernes de 8:00 a 18:00",
      address: "CDMX",
    };
  }
  return info.toObject();
}

module.exports = { getBusinessInfo, MAPS_URL, STORE_ADDRESS };
