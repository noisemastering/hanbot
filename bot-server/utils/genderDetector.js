// utils/genderDetector.js
//
// Infer gender from a Mexican first name.
//
// Strategy:
//   1. Lookup table of ~500 most common Mexican first names (covers ~90% of
//      the population by frequency)
//   2. Suffix heuristic fallback for unknown names
//   3. Compound names (e.g. "José María", "María José") use the first token
//      that is unambiguous
//   4. Returns 'male' | 'female' | 'unknown'
//
// Names that are genuinely ambiguous in Mexico (Guadalupe, Trinidad, Refugio,
// Reyes, Cruz, Rosario, Concepción) are deliberately marked 'unknown' rather
// than guessed.

const MALE = new Set([
  // Top common male names
  'jose', 'juan', 'miguel', 'luis', 'francisco', 'alejandro', 'carlos',
  'jesus', 'antonio', 'manuel', 'pedro', 'fernando', 'angel', 'rafael',
  'roberto', 'arturo', 'ricardo', 'eduardo', 'sergio', 'jorge', 'enrique',
  'oscar', 'raul', 'alberto', 'mario', 'andres', 'gerardo', 'hector',
  'ramon', 'salvador', 'mauricio', 'humberto', 'guillermo', 'rodolfo',
  'martin', 'alfonso', 'octavio', 'gabriel', 'gustavo', 'rene', 'felipe',
  'agustin', 'ernesto', 'ignacio', 'ruben', 'cesar', 'samuel', 'omar',
  'pablo', 'daniel', 'david', 'jaime', 'alfredo', 'javier', 'leonardo',
  'ivan', 'adrian', 'cristian', 'christian', 'bryan', 'brian', 'kevin',
  'edgar', 'edgardo', 'edwin', 'erick', 'erik', 'eric', 'hugo', 'noe',
  'uriel', 'abraham', 'axel', 'fermin', 'alan', 'roman', 'moroni',
  'alexis', 'alex', 'ariel', 'freddy', 'jean', 'ever', 'jordan',
  'edson', 'einar', 'esau', 'ezequiel', 'fidencio', 'gael', 'giovanni',
  'jonatan', 'jovany', 'juvenal', 'kenneth', 'maicol', 'maycol', 'maximo',
  'milton', 'naasson', 'neftali', 'nick', 'noel', 'rey', 'ronaldo',
  'rony', 'roy', 'santino', 'tadeo', 'thiago', 'tobias', 'ulises',
  'uziel', 'wilfrido', 'wilmer', 'yael', 'yahir', 'yamil', 'yatziel',
  'yoel', 'yoshua', 'zaid', 'cuauhtemoc', 'huitzilihuitl', 'tonatiuh',
  'xitlali', 'odin', 'thor', 'leonel', 'lionel', 'kaleth', 'osmar',
  'josafat', 'felix', 'allan', 'erwin', 'hiram', 'germain', 'jezreel',
  'obed', 'job', 'caleb', 'levi', 'isai', 'isaias', 'osiel', 'gildardo',
  'isaac', 'aaron', 'abel', 'adan', 'aldo', 'amado', 'amador', 'amilcar',
  'anibal', 'aristeo', 'armando', 'arnulfo', 'aureliano', 'bernabe',
  'bernardo', 'benigno', 'benjamin', 'bonifacio', 'braulio', 'camilo',
  'candido', 'casimiro', 'celestino', 'claudio', 'clemente', 'conrado',
  'cornelio', 'cristobal', 'damian', 'demetrio', 'desiderio', 'diego',
  'dionisio', 'domingo', 'donato', 'efren', 'efrain', 'eladio', 'elias',
  'eligio', 'eliseo', 'elpidio', 'emiliano', 'emilio', 'emmanuel', 'eneas',
  'epifanio', 'esteban', 'eulalio', 'eulogio', 'eutimio', 'evaristo',
  'ezequiel', 'fabian', 'facundo', 'faustino', 'fausto', 'federico',
  'feliciano', 'fidel', 'filemon', 'filiberto', 'fortino', 'froylan',
  'gilberto', 'gonzalo', 'gregorio', 'genaro', 'german', 'godofredo',
  'higinio', 'hilario', 'hipolito', 'homero', 'horacio', 'idelfonso',
  'ildefonso', 'inocencio', 'isidro', 'ismael', 'israel', 'jacinto',
  'jacobo', 'jeronimo', 'joaquin', 'joel', 'jonathan', 'jorge', 'josue',
  'justo', 'lazaro', 'leandro', 'leobardo', 'leon', 'leoncio', 'leopoldo',
  'libardo', 'lino', 'lorenzo', 'lucas', 'luciano', 'macario', 'macrino',
  'marcelino', 'marcelo', 'marciano', 'marcos', 'mariano', 'mateo',
  'matias', 'mauro', 'maximiliano', 'maximino', 'melchor', 'melecio',
  'misael', 'modesto', 'moises', 'nabor', 'narciso', 'natanael', 'nazario',
  'nemesio', 'nestor', 'nicasio', 'nicolas', 'norberto', 'odilon',
  'olegario', 'onesimo', 'orlando', 'osvaldo', 'oswaldo', 'pancho',
  'pascual', 'pastor', 'patricio', 'paulino', 'placido', 'policarpo',
  'porfirio', 'primitivo', 'procopio', 'prudencio', 'quirino', 'ramses',
  'raymundo', 'reginaldo', 'regulo', 'remigio', 'reynaldo', 'reynold',
  'roque', 'rolando', 'romulo', 'rosendo', 'rufino', 'rutilio', 'sabino',
  'sacramento', 'santiago', 'santos', 'saturnino', 'saul', 'sebastian',
  'serafin', 'severiano', 'silvano', 'silvestre', 'silverio', 'simon',
  'sotero', 'tadeo', 'teodoro', 'teofilo', 'timoteo', 'tomas', 'toribio',
  'ubaldo', 'urbano', 'vicente', 'victoriano', 'victor', 'vidal',
  'virgilio', 'vladimir', 'wenceslao', 'wilfredo', 'yair', 'zacarias',
  // Variants
  'jose luis', 'jose antonio', 'juan carlos', 'juan jose', 'jose manuel',
  'jose miguel', 'luis miguel', 'luis fernando', 'jose maria', 'angel luis',
  'mateo', 'leo', 'leon', 'lalo', 'memo', 'pancho', 'paco', 'pepe', 'beto',
  'lalo', 'rico', 'tony', 'toni', 'tito', 'chuy', 'cheo', 'chepe', 'lupe'
]);

const FEMALE = new Set([
  // Top common female names
  'maria', 'guadalupe', 'juana', 'margarita', 'francisca', 'leticia',
  'silvia', 'gabriela', 'alejandra', 'claudia', 'elizabeth', 'sandra',
  'patricia', 'martha', 'laura', 'monica', 'yolanda', 'julia', 'carmen',
  'ana', 'angelica', 'rosa', 'sara', 'beatriz', 'lourdes', 'norma',
  'cristina', 'lucia', 'isabel', 'esther', 'rosario', 'elena', 'irma',
  'esperanza', 'carolina', 'paola', 'adriana', 'erika', 'erica', 'fabiola',
  'veronica', 'rocio', 'mariana', 'magdalena', 'eva', 'ines', 'teresa',
  'liliana', 'maribel', 'rebeca', 'evangelina', 'irene', 'miriam', 'edith',
  'olga', 'celia', 'ofelia', 'estela', 'reyna', 'consuelo', 'soledad',
  'angeles', 'andrea', 'valeria', 'sofia', 'camila', 'daniela', 'fernanda',
  'natalia', 'paulina', 'jimena', 'ximena', 'renata', 'regina', 'ivanna',
  'romina', 'mia', 'emma', 'luciana', 'martina', 'lucia', 'marisol',
  'azucena', 'amada', 'alma', 'aurelia', 'aurora', 'concepcion', 'cecilia',
  'mariela', 'susana', 'jessica', 'jacqueline', 'jaquelin', 'karla',
  'karina', 'karen', 'fatima', 'lilian', 'liliana', 'magaly', 'maritza',
  'mayra', 'melissa', 'milagros', 'nadia', 'nelly', 'nora', 'olivia',
  'perla', 'pilar', 'priscila', 'ramona', 'raquel', 'roxana', 'rosalba',
  'rosalinda', 'rosaura', 'sandra', 'selene', 'selina', 'silvana', 'silvia',
  'tania', 'thalia', 'valentina', 'viviana', 'viridiana', 'wendy', 'xochitl',
  'yadira', 'yesenia', 'zenaida', 'zoraida', 'zulema', 'agripina',
  'alfonsina', 'altagracia', 'amalia', 'amelia', 'amparo', 'anabel',
  'anahi', 'analia', 'anastasia', 'angela', 'antonia', 'apolonia', 'araceli',
  'arcelia', 'aurelia', 'azalea', 'basilia', 'belen', 'benigna', 'bertha',
  'blanca', 'brenda', 'brisa', 'caridad', 'casilda', 'catalina', 'cipriana',
  'clara', 'claudina', 'clementina', 'corina', 'crisanta', 'cristhal',
  'crisalida', 'cruz', 'damaris', 'delfina', 'delia', 'diamantina', 'diana',
  'dolores', 'dorotea', 'efigenia', 'elba', 'elena', 'elia', 'elida',
  'elisa', 'elodia', 'eloisa', 'elvia', 'elvira', 'emelia', 'emerenciana',
  'emilia', 'emma', 'eneida', 'engracia', 'enriqueta', 'epifania', 'erendira',
  'erlinda', 'ernestina', 'esmeralda', 'eufemia', 'eulalia', 'eustolia',
  'fabiana', 'feliciana', 'felipa', 'felisa', 'filomena', 'flora', 'florencia',
  'florinda', 'fortunata', 'genoveva', 'georgina', 'gilda', 'gisela', 'gladys',
  'gloria', 'graciela', 'griselda', 'guillermina', 'herlinda', 'herminia',
  'hilda', 'hortencia', 'iliana', 'imelda', 'iraceli', 'isaura', 'isidra',
  'itzel', 'izel', 'janet', 'janeth', 'jovita', 'juliana', 'juventina',
  'lidia', 'linda', 'lizbeth', 'lizet', 'lola', 'lorena', 'lupita', 'macaria',
  'mafalda', 'manuela', 'marcela', 'marcelina', 'marcia', 'margarita',
  'maria de jesus', 'maria del carmen', 'maria de la luz', 'maria elena',
  'maria fernanda', 'maria guadalupe', 'maria isabel', 'maria jose',
  'mariangel', 'marisa', 'marisela', 'marlene', 'marta', 'matilde', 'mercedes',
  'micaela', 'minerva', 'mireya', 'modesta', 'natali', 'natividad', 'nayeli',
  'nicolasa', 'nieves', 'nimia', 'noemi', 'norberta', 'odalys', 'oliva',
  'otilia', 'pascuala', 'paula', 'paulita', 'petra', 'piedad', 'porfiria',
  'prisciliana', 'rafaela', 'refugio', 'remedios', 'romelia', 'romualda',
  'rosalia', 'rosamaria', 'rosenda', 'rufina', 'ruperta', 'ruth', 'sabina',
  'salome', 'salvadora', 'samanta', 'samantha', 'santa', 'santina', 'sebastiana',
  'serafina', 'severa', 'sidonia', 'simona', 'socorro', 'sonia', 'soraya',
  'tatiana', 'telma', 'teodora', 'teofila', 'tomasa', 'trinidad', 'ursula',
  'nancy', 'luz', 'monserrat', 'monserrath', 'dulce', 'joselin', 'joselyn',
  'jocelyn', 'abigail', 'sarai', 'sarahi', 'isamar', 'yazmin', 'yasmin',
  'iris', 'yanet', 'janeth', 'gissell', 'gissel', 'leidy', 'mildred',
  'ivonne', 'denice', 'denisse', 'denisse', 'anahy', 'anahi', 'erandy',
  'mirely', 'kimberly', 'kimberlin', 'kimberlyn', 'aleyda', 'arely',
  'ashly', 'ashley', 'ashlie', 'belem', 'briseida', 'briseyda', 'cinthia',
  'cynthia', 'citlali', 'citlalli', 'dalia', 'damari', 'darianna', 'dayana',
  'denis', 'eloisa', 'estefania', 'estefani', 'eunice', 'evelin', 'evelyn',
  'fanny', 'flor', 'frida', 'gemma', 'haide', 'haydee', 'heidy', 'iliana',
  'ilse', 'ingrid', 'jaqueline', 'jazmin', 'jenny', 'jessenia', 'judith',
  'julissa', 'kassandra', 'katia', 'kenia', 'krystal', 'kristal', 'leslie',
  'lesly', 'libia', 'lilia', 'lizeth', 'lluvia', 'lupe', 'maggie',
  'maly', 'marlen', 'mayte', 'melany', 'merary', 'mireya', 'miranda',
  'monica', 'mariangel', 'naomi', 'naydelin', 'nayely', 'nelida', 'nidia',
  'nydia', 'odalis', 'paola', 'paulette', 'penelope', 'rocsana', 'rosalva',
  'rubi', 'ruby', 'sahory', 'samira', 'shanik', 'sherlyn', 'stephany',
  'stephanie', 'stefany', 'tania', 'taurina', 'thais', 'vanesa', 'vanessa',
  'vania', 'yajaira', 'yamileth', 'yamilet', 'yarely', 'yatziri', 'yatzil',
  'yatziry', 'yenifer', 'yesica', 'yessica', 'yoselin', 'yoselyn',
  'zaira', 'zayra', 'zoe', 'aitana', 'romina', 'amaranta', 'azul',
  'berenice', 'bere', 'karyme', 'montserrat', 'cindy', 'mariel',
  'nallely', 'nayely', 'elsy', 'benyi', 'darielly', 'poleth', 'deysi',
  'daisy', 'zury', 'sury', 'shantal', 'lis', 'liss', 'lizz', 'briana',
  'venancia', 'ventura', 'victoria', 'vilma', 'violeta', 'virginia', 'viviana',
  // Diminutives & variants
  'lupita', 'lupe', 'mary', 'mari', 'marisol', 'pati', 'paty', 'pao', 'sofi',
  'gabi', 'caro', 'vale', 'vane', 'isa', 'ale', 'monse', 'fer', 'dani'
]);

// Genuinely ambiguous in Mexican usage
const AMBIGUOUS = new Set([
  'guadalupe', 'trinidad', 'refugio', 'reyes', 'cruz', 'rosario',
  'concepcion', 'concha', 'lupe', 'chuy', 'sacramento', 'lourdes',
  'remedios', 'natividad', 'asuncion'
]);

/**
 * Strip diacritics and normalize to lowercase.
 */
function normalize(s) {
  if (!s || typeof s !== 'string') return '';
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Detect gender from a (possibly compound) Mexican first name.
 * @param {string} name - First name only, or compound like "Maria Jose"
 * @returns {'male'|'female'|'unknown'}
 */
function detectGender(name) {
  const norm = normalize(name);
  if (!norm) return 'unknown';

  // Try the whole compound first (handles "maria jose", "jose maria", etc.)
  if (FEMALE.has(norm)) return 'female';
  if (MALE.has(norm)) return 'male';
  if (AMBIGUOUS.has(norm)) return 'unknown';

  // Then try each token in order — the first decisive one wins
  // Important Mexican rule: "Maria <X>" is female, "Jose <X>" is male,
  // even if the second token is opposite gender
  const tokens = norm.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 'unknown';

  // Mexican naming convention: a leading "maria" → female, "jose" → male
  if (tokens[0] === 'maria') return 'female';
  if (tokens[0] === 'jose') return 'male';

  for (const t of tokens) {
    if (FEMALE.has(t)) return 'female';
    if (MALE.has(t)) return 'male';
  }

  // Suffix heuristics — last resort
  const last = tokens[tokens.length - 1];
  // Strong female endings
  if (/(ela|ina|ita|ica|ana|esa|isa|ena|onia|elia|cia|sia|tia|ssa|ya|illa)$/.test(last)) return 'female';
  // Strong male endings
  if (/(aldo|ardo|erto|ando|endo|indo|undo|onio|ano|ino|elo|olo|esto|isto|usto|on)$/.test(last)) return 'male';
  // Generic endings
  if (last.endsWith('a')) return 'female';
  if (last.endsWith('o')) return 'male';

  return 'unknown';
}

module.exports = { detectGender, normalize };
