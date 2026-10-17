import { normalize, type Entity } from "./socrata.js";
import { distance, matchEntity } from "./places.js";

/** [NIT del índice data/entities.json, nombre común, ...siglas y formas de decirlo]. Cada NIT se verifica contra el índice en tests/regression. */
const TABLE: [string, string, ...string[]][] = [
  ["899999053", "Ministerio de Tecnologías de la Información y las Comunicaciones", "MinTIC", "Min TIC", "Ministerio TIC", "Ministerio de las TIC", "Ministerio de Tecnología", "Ministerio de Tecnologías", "Ministerio de Tecnologías de la Información"],
  ["8001316486", "Fondo Único de Tecnologías de la Información y las Comunicaciones", "FonTIC", "Fondo Único de TIC"],
  ["900474727", "Ministerio de Salud y Protección Social", "MinSalud", "Min Salud", "Ministerio de Salud", "Ministerio de Salud y Protección Social"],
  ["899999001", "Ministerio de Educación Nacional", "MinEducación", "Min Educación", "MEN", "Ministerio de Educación"],
  ["899999003", "Ministerio de Defensa Nacional", "MinDefensa", "Min Defensa", "Ministerio de Defensa"],
  ["899999090", "Ministerio de Hacienda y Crédito Público", "MinHacienda", "Min Hacienda", "Ministerio de Hacienda", "Hacienda Nacional"],
  ["830114475", "Ministerio del Interior", "MinInterior", "Min Interior"],
  ["899999022", "Ministerio de Minas y Energía", "MinMinas", "Min Minas", "Ministerio de Minas"],
  ["899999055", "Ministerio de Transporte", "MinTransporte", "Min Transporte"],
  ["830115297", "Ministerio de Comercio, Industria y Turismo", "MinCIT", "MinComercio", "Ministerio de Comercio"],
  ["899999042", "Ministerio de Relaciones Exteriores", "Cancillería", "MinRelaciones", "Ministerio de Relaciones"],
  ["901733502", "Ministerio de Igualdad y Equidad", "MinIgualdad", "Ministerio de Igualdad"],
  ["899999306", "Ministerio del Deporte", "MinDeporte", "Min Deporte"],
  ["830034348", "Ministerio de las Culturas, las Artes y los Saberes", "MinCultura", "Ministerio de Cultura", "Ministerio de las Culturas"],
  ["830115395", "Ministerio de Ambiente y Desarrollo Sostenible", "MinAmbiente", "Min Ambiente", "Ministerio de Ambiente"],
  ["899999028", "Ministerio de Agricultura y Desarrollo Rural", "MinAgricultura", "Min Agricultura", "Ministerio de Agricultura"],
  ["900457461", "Ministerio de Justicia y del Derecho", "MinJusticia", "Min Justicia", "Ministerio de Justicia"],
  ["899999011", "Departamento Nacional de Planeación", "DNP", "Planeación Nacional"],
  ["899999020", "Departamento Administrativo de la Función Pública", "Función Pública", "DAFP"],
  ["900039533", "Prosperidad Social", "DPS", "Departamento para la Prosperidad Social"],
  ["899999119", "Procuraduría General de la Nación", "Procuraduría"],
  ["800186061", "Defensoría del Pueblo", "Defensoría"],
  ["800152783", "Fiscalía General de la Nación", "Fiscalía"],
  ["899999737", "Fondo Rotatorio de la Registraduría", "Registraduría", "Registraduría Nacional", "RNEC"],
  ["860020227", "Fondo Rotatorio de la Policía Nacional", "Policía", "Policía Nacional", "PONAL"],
  ["800230729", "Comando General de las Fuerzas Militares", "Fuerzas Militares", "Comando General"],
  ["899999162", "Agencia Logística de las Fuerzas Militares", "Agencia Logística"],
  ["899999118", "Caja de Retiro de las Fuerzas Militares", "CREMIL"],
  ["800215546", "Instituto Nacional Penitenciario y Carcelario", "INPEC"],
  ["900523392", "Unidad de Servicios Penitenciarios y Carcelarios", "USPEC"],
  ["800093816", "Rama Judicial", "Consejo Superior de la Judicatura"],
  ["901140004", "Jurisdicción Especial para la Paz", "JEP"],
  ["899999098", "Cámara de Representantes", "Cámara"],
  ["899999103", "Congreso de la República (Senado)", "Senado", "Congreso"],
  ["800197268", "Dirección de Impuestos y Aduanas Nacionales", "DIAN", "Impuestos Nacionales"],
  ["800215807", "Instituto Nacional de Vías", "INVIAS", "Invías", "Instituto Nacional de Vías"],
  ["8301259969", "Agencia Nacional de Infraestructura", "ANI"],
  ["901525615", "Unidad de Planeación de Infraestructura de Transporte", "UPIT"],
  ["899999239", "Instituto Colombiano de Bienestar Familiar", "ICBF", "Bienestar Familiar"],
  ["899999034", "Servicio Nacional de Aprendizaje", "SENA"],
  ["900478966", "Unidad Nacional para la Gestión del Riesgo de Desastres", "UNGRD", "Gestión del Riesgo"],
  ["900490473", "Unidad para las Víctimas", "UARIV", "Unidad de Víctimas"],
  ["900948953", "Agencia Nacional de Tierras", "ANT"],
  ["900948958", "Agencia de Desarrollo Rural", "ADR"],
  ["830127607", "Agencia Nacional de Hidrocarburos", "ANH"],
  ["899999294", "Servicio Geológico Colombiano", "SGC"],
  ["900334265", "Agencia Nacional del Espectro", "ANE"],
  ["800176089", "Superintendencia de Industria y Comercio", "SIC", "Superindustria"],
  ["800250984", "Superintendencia de Servicios Públicos Domiciliarios", "Superservicios"],
  ["860062187", "Superintendencia Nacional de Salud", "Supersalud"],
  ["830053043", "Superintendencia de la Economía Solidaria", "Supersolidaria"],
  ["800170433", "Superintendencia de Transporte", "Supertransporte"],
  ["890999057", "Superintendencia Financiera de Colombia", "Superfinanciera"],
  ["899999007", "Superintendencia de Notariado y Registro", "Supernotariado"],
  ["900336004", "Colpensiones", "Administradora Colombiana de Pensiones"],
  ["899999403", "Instituto Nacional de Salud", "INS"],
  ["800150861", "Instituto Nacional de Medicina Legal", "Medicina Legal"],
  ["899999069", "Instituto Colombiano Agropecuario", "ICA"],
  ["830000167", "Instituto Nacional de Vigilancia de Medicamentos y Alimentos", "INVIMA", "Invima"],
  ["900477235", "Migración Colombia", "Unidad Administrativa Especial Migración Colombia"],
  ["900514813", "Colombia Compra Eficiente", "Colombia Compra", "CCE"],
  ["800128835", "Archivo General de la Nación", "AGN"],
  ["900492141", "Centro Nacional de Memoria Histórica", "CNMH"],
  ["900062917", "Servicios Postales Nacionales", "4-72", "Servicios Postales"],
  ["899999035", "ICETEX", "Instituto Colombiano de Crédito Educativo"],
  ["899999054", "Escuela Superior de Administración Pública", "ESAP"],
  ["899999063", "Universidad Nacional de Colombia", "UNAL", "Universidad Nacional"],
  ["899999124", "Universidad Pedagógica Nacional", "UPN"],
  ["890980040", "Universidad de Antioquia", "UdeA"],
  ["890399010", "Universidad del Valle", "Univalle"],
  ["899999230", "Universidad Distrital Francisco José de Caldas", "Universidad Distrital"],
  ["899999081", "Instituto de Desarrollo Urbano de Bogotá", "IDU"],
  ["860061099", "Instituto Distrital de Recreación y Deporte", "IDRD"],
  ["830063506", "TransMilenio", "Transmilenio"],
  ["901038962", "Metro de Bogotá", "Metro de Bogotá"],
  ["899999094", "Empresa de Acueducto y Alcantarillado de Bogotá", "EAAB", "Acueducto de Bogotá"],
  ["890399011", "Alcaldía de Santiago de Cali", "Alcaldía de Cali", "Alcaldía de Santiago de Cali"],
  ["890905211", "Distrito de Medellín", "Alcaldía de Medellín", "Distrito de Medellín"],
  ["890102018", "Distrito de Barranquilla", "Alcaldía de Barranquilla", "Distrito de Barranquilla"],
  ["890480184", "Distrito de Cartagena", "Alcaldía de Cartagena", "Distrito de Cartagena"],
  ["891780009", "Distrito de Santa Marta", "Alcaldía de Santa Marta"],
  ["891280000", "Alcaldía de Pasto", "Alcaldía de Pasto"],
  ["891800846", "Municipio de Tunja", "Alcaldía de Tunja"],
  ["890801053", "Municipio de Manizales", "Alcaldía de Manizales"],
  ["891480030", "Municipio de Pereira", "Alcaldía de Pereira"],
  ["890201222", "Municipio de Bucaramanga", "Alcaldía de Bucaramanga"],
  ["890501434", "Municipio de San José de Cúcuta", "Alcaldía de Cúcuta"],
  ["891180009", "Municipio de Neiva", "Alcaldía de Neiva"],
  ["800098911", "Alcaldía de Valledupar", "Alcaldía de Valledupar"],
  ["800096734", "Municipio de Montería", "Alcaldía de Montería"],
  ["800104062", "Municipio de Sincelejo", "Alcaldía de Sincelejo"],
  ["891580006", "Alcaldía de Popayán", "Alcaldía de Popayán"],
  ["892099324", "Alcaldía de Villavicencio", "Alcaldía de Villavicencio"],
  ["800113389", "Alcaldía de Ibagué", "Alcaldía de Ibagué"],
  ["891855017", "Municipio de Yopal", "Alcaldía de Yopal"],
  ["800095728", "Municipio de Florencia", "Alcaldía de Florencia"],
  ["891680011", "Alcaldía de Quibdó", "Alcaldía de Quibdó"],
  ["892115007", "Alcaldía de Riohacha", "Alcaldía de Riohacha"],
  ["890000464", "Municipio de Armenia (Quindío)", "Alcaldía de Armenia"],
  ["800094755", "Municipio de Soacha", "Alcaldía de Soacha"],
  ["890980112", "Alcaldía de Bello", "Alcaldía de Bello"],
  ["890900286", "Gobernación de Antioquia", "Gobernación de Antioquia", "Departamento de Antioquia"],
  ["890102006", "Gobernación del Atlántico", "Gobernación del Atlántico", "Departamento del Atlántico"],
  ["890480059", "Gobernación de Bolívar", "Gobernación de Bolívar"],
  ["891800498", "Gobernación de Boyacá", "Gobernación de Boyacá"],
  ["890801052", "Gobernación de Caldas", "Gobernación de Caldas"],
  ["892099216", "Gobernación de Casanare", "Gobernación de Casanare"],
  ["891580016", "Gobernación del Cauca", "Gobernación del Cauca"],
  ["892399999", "Gobernación del Cesar", "Gobernación del Cesar"],
  ["891680010", "Gobernación del Chocó", "Gobernación del Chocó"],
  ["800103935", "Gobernación de Córdoba", "Gobernación de Córdoba", "Departamento de Córdoba"],
  ["8921150151", "Gobernación de La Guajira", "Gobernación de La Guajira"],
  ["800103913", "Gobernación del Huila", "Gobernación del Huila"],
  ["800103920", "Gobernación del Magdalena", "Gobernación del Magdalena"],
  ["8920001488", "Gobernación del Meta", "Gobernación del Meta", "Departamento del Meta"],
  ["800103923", "Gobernación de Nariño", "Gobernación de Nariño"],
  ["800103927", "Gobernación de Norte de Santander", "Gobernación de Norte de Santander"],
  ["890001639", "Gobernación del Quindío", "Gobernación del Quindío"],
  ["891480085", "Gobernación de Risaralda", "Gobernación de Risaralda"],
  ["892400038", "Gobernación de San Andrés, Providencia y Santa Catalina", "Gobernación de San Andrés"],
  ["890201235", "Gobernación de Santander", "Gobernación de Santander", "Departamento de Santander"],
  ["892280021", "Gobernación de Sucre", "Gobernación de Sucre"],
];

/** Sigla o nombre común (sin tildes ni mayúsculas) -> NIT. */
export const ALIASES: Record<string, string> = {};
/** NIT -> nombre común (para cuando el índice de entidades no lo trae). */
export const ALIAS_LABEL: Record<string, string> = {};
for (const [nit, label, ...names] of TABLE) {
  ALIAS_LABEL[nit] ??= label;
  for (const n of [label, ...names]) ALIASES[normalize(n)] ??= nit;
}

/** NIT cuando el texto es exactamente una sigla o nombre común conocido. */
export const aliasNit = (texto: string): string | undefined => {
  const n = normalize(texto);
  if (ALIASES[n]) return ALIASES[n];
  // Error de escritura o de transcripción («INBIAS»): una sola edición y una sola sigla posible.
  const near = n.length >= 5 ? Object.keys(ALIASES).filter((k) => k.length >= 5 && Math.abs(k.length - n.length) <= 1 && distance(n, k) <= 1) : [];
  return near.length === 1 ? ALIASES[near[0]!] : undefined;
};

export interface Candidato { nit: string; nombre: string; confianza: number }

/** Candidatos para un texto: primero siglas y nombres comunes, luego coincidencia aproximada contra el índice. El primero es el más probable. */
export function buscarEntidad(texto: string, entities: Entity[]): { candidatos: Candidato[] } {
  const out = new Map<string, Candidato>();
  const name = (nit: string) => entities.find((e) => e.nit === nit)?.name ?? ALIAS_LABEL[nit] ?? `NIT ${nit}`;
  const add = (nit: string, confianza: number) => { if (!out.has(nit)) out.set(nit, { nit, nombre: name(nit), confianza }); };
  const n = ` ${normalize(texto)} `;
  const exact = aliasNit(texto);
  if (exact) add(exact, 1);
  // La sigla dentro de una frase («contratos del ICBF»): la más larga primero.
  for (const k of Object.keys(ALIASES).sort((a, b) => b.length - a.length)) if (k.length > 2 && n.includes(` ${k} `)) add(ALIASES[k], 0.9);
  if (entities.length) {
    const m = matchEntity(texto, entities);
    if ("entity" in m) add(m.entity.nit, 0.7);
    else for (const s of m.sugerencias) { const e = entities.find((x) => x.name === s); if (e) add(e.nit, 0.4); }
  }
  return { candidatos: [...out.values()].slice(0, 5) };
}
