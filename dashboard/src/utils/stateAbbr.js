// Mexican state abbreviations
// Common short forms used in addresses, license plates, and INEGI

export const STATE_ABBR = {
  "aguascalientes": "Ags.", "baja california": "B.C.", "baja california sur": "B.C.S.",
  "campeche": "Camp.", "chiapas": "Chis.", "chihuahua": "Chih.",
  "ciudad de méxico": "CDMX", "ciudad de mexico": "CDMX", "cdmx": "CDMX",
  "coahuila": "Coah.", "coahuila de zaragoza": "Coah.", "colima": "Col.",
  "durango": "Dgo.", "guanajuato": "Gto.", "guerrero": "Gro.",
  "hidalgo": "Hgo.", "jalisco": "Jal.",
  "méxico": "Edoméx", "mexico": "Edoméx", "estado de méxico": "Edoméx",
  "michoacán": "Mich.", "michoacan": "Mich.", "michoacán de ocampo": "Mich.",
  "morelos": "Mor.", "nayarit": "Nay.", "nuevo león": "N.L.", "nuevo leon": "N.L.",
  "oaxaca": "Oax.", "puebla": "Pue.", "querétaro": "Qro.", "queretaro": "Qro.",
  "quintana roo": "Q. Roo", "san luis potosí": "S.L.P.", "san luis potosi": "S.L.P.",
  "sinaloa": "Sin.", "sonora": "Son.", "tabasco": "Tab.",
  "tamaulipas": "Tamps.", "tlaxcala": "Tlax.",
  "veracruz": "Ver.", "veracruz de ignacio de la llave": "Ver.",
  "yucatán": "Yuc.", "yucatan": "Yuc.", "zacatecas": "Zac.",
};

export function abbrState(name) {
  if (!name) return name;
  return STATE_ABBR[name.toLowerCase().trim()] || name;
}
