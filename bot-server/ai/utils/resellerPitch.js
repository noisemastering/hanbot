// ai/utils/resellerPitch.js
// Static reseller pitch messages, extracted from the legacy resellerFlow.js so the
// pitches can outlive the legacy flow file.
// Used by: bot-server/index.js (greeting fallback for reseller-flagged ad clicks).

const PITCH_MESSAGES = {
  malla_sombra:
    `Estamos buscando revendedores para nuestra malla sombra raschel confeccionada con 90% de cobertura y protección UV.\n\n` +
    `Viene con refuerzo en las esquinas para una vida útil de hasta 5 años, y con ojillos para sujeción cada 80 cm por lado, lista para instalar. El envío está incluido.\n\n` +
    `Manejamos medidas desde 2x2m hasta 7x10m.\n\n` +
    `Si deseas ampliar el catálogo de tu negocio con un producto de primera calidad y fabricación 100% mexicana, nos encantaría tenerte en nuestra red de distribuidores.\n\n` +
    `Si solo buscas comprar al mayoreo por favor indícanos la medida y tu código postal.\n\n` +
    `Si solo buscas una malla sombra, solo indícanos la medida.`,
  borde_separador:
    `Somos fabricantes de borde separador de jardín, el complemento perfecto para paisajistas, ferreterías y viveros.\n\n` +
    `Nuestro borde es más grueso y resistente que los de la competencia, fácil de instalar y con alta demanda.\n\n` +
    `Manejamos rollos de 18m y 54m con envío a todo México.\n\n` +
    `Si deseas ampliar el catálogo de tu negocio con un producto de primera calidad y fabricación 100% mexicana, nos encantaría tenerte en nuestra red de distribuidores.\n\n` +
    `Si solo buscas comprar al mayoreo por favor indícanos el largo y tu código postal.\n\n` +
    `Si solo buscas un borde para tu jardín, solo indícanos el largo que necesitas.`
};

function getPitchMessage(productInterest) {
  return PITCH_MESSAGES[productInterest] || PITCH_MESSAGES.malla_sombra;
}

module.exports = { PITCH_MESSAGES, getPitchMessage };
