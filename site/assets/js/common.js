// Shared pieces: reading and checking a building, the protection levels, formats, and the hand-off
// between pages.

export const LEVELS = [
  { id: 'I', radius: 20, current: 3, intercept: 0.99, use: 'Explosives, hospitals with life support' },
  { id: 'II', radius: 30, current: 5, intercept: 0.97, use: 'Fuel stores, telecoms, high-risk buildings' },
  { id: 'III', radius: 45, current: 10, intercept: 0.91, use: 'Most homes, schools, offices' },
  { id: 'IV', radius: 60, current: 16, intercept: 0.84, use: 'Low-risk sheds and farm buildings' },
];
export const levelById = (id) => LEVELS.find((l) => l.id === id) || LEVELS[2];

export const KINDS = { building: 1, fitting: 2, tree: 3, terminal: 4 };
export const KIND_NAMES = ['Ground', 'Building', 'Roof fitting', 'Tree', 'Air terminal'];
export const SHAPES = { box: 1, gable: 2, hip: 3, tank: 4, tree: 5, pole: 6, rod: 7 };
export const FIELDS = 9;
export const MAX_ELEMENTS = 80;
export const MAX_FILE = 64 * 1024;
export const EXAMPLES = {
  house: 'Two-storey house',
  farm: 'Farmhouse and a gum tree',
  church: 'Church with a steeple',
  flats: 'Apartment block',
};

// ---------- Checking a building ----------

export class PlanError extends Error {}

const NAME = /^[\p{L}\p{N} .,'()&\/-]{1,40}$/u;
function num(v, lo, hi, what) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw new PlanError(`${what} must be a number from ${lo} to ${hi}`);
  return v;
}
function text(v, what) {
  if (typeof v !== 'string' || !NAME.test(v)) throw new PlanError(`${what} must be a short name (letters, digits and simple punctuation)`);
  return v;
}

// Turns a building description (already parsed JSON) into checked elements. Everything that
// reaches the page or the model goes through here; the C core checks the numbers again.
export function checkBuilding(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new PlanError('the file must be a JSON object');
  const name = data.name === undefined ? 'My building' : text(data.name, 'the building name');
  const about = typeof data.about === 'string' ? data.about.slice(0, 300) : '';
  if (!Array.isArray(data.elements) || data.elements.length < 1 || data.elements.length > MAX_ELEMENTS) {
    throw new PlanError(`elements must list 1 to ${MAX_ELEMENTS} parts of the building`);
  }
  const M = 100, H = 60;
  const elements = data.elements.map((e, i) => {
    const at = `part ${i + 1}`;
    if (!e || typeof e !== 'object' || Array.isArray(e)) throw new PlanError(`${at} must be an object`);
    const type = e.type;
    if (!Object.hasOwn(SHAPES, type)) throw new PlanError(`${at}: type must be one of ${Object.keys(SHAPES).join(', ')}`);
    const kind = type === 'tree' ? 'tree' : type === 'rod' ? 'terminal' : e.kind ?? 'building';
    if (!Object.hasOwn(KINDS, kind)) throw new PlanError(`${at}: kind must be building, fitting, tree or terminal`);
    const out = { type, kind, name: e.name === undefined ? `${type} ${i + 1}` : text(e.name, `${at}: the name`) };
    out.x = num(e.x, -M, M, `${at}: x`);
    out.y = num(e.y, -M, M, `${at}: y`);
    if (type === 'box' || type === 'gable' || type === 'hip') {
      out.w = num(e.w, 0.5, 2 * M, `${at}: w`);
      out.d = num(e.d, 0.5, 2 * M, `${at}: d`);
      if (out.x + out.w > M || out.y + out.d > M) throw new PlanError(`${at} reaches past ${M} m from the origin`);
      if (type === 'box') out.h = num(e.h, 0.1, H, `${at}: h`);
      else {
        out.eave = num(e.eave, 0.5, H, `${at}: eave`);
        out.ridge = num(e.ridge, out.eave, H, `${at}: ridge`);
      }
      if (type === 'gable') {
        const runs = e.ridgeRuns ?? 'east-west';
        if (runs !== 'east-west' && runs !== 'north-south') throw new PlanError(`${at}: ridgeRuns must be east-west or north-south`);
        out.ridgeRuns = runs;
      }
    } else if (type === 'tank') {
      out.r = num(e.r, 0.2, 30, `${at}: r`);
      out.h = num(e.h, 0.1, H, `${at}: h`);
    } else if (type === 'tree') {
      out.r = num(e.r, 0.5, 20, `${at}: r`);
      out.base = num(e.base, 0, H - 0.5, `${at}: base`);
      out.top = num(e.top, out.base + 0.5, H, `${at}: top`);
    } else if (type === 'pole') {
      out.h = num(e.h, 0.3, H, `${at}: h`);
    } else {
      out.length = num(e.length, 0.2, 10, `${at}: length`);
    }
    return out;
  });
  return { name, about, elements };
}

export function parseBuilding(textContent) {
  if (typeof textContent !== 'string' || textContent.length > MAX_FILE) throw new PlanError('the file must be under 64 KB');
  let data;
  try {
    data = JSON.parse(textContent);
  } catch {
    throw new PlanError('the file is not valid JSON');
  }
  return checkBuilding(data);
}

// The numbers the C core takes: one row of FIELDS per element.
export function toRows(elements) {
  const rows = new Float64Array(elements.length * FIELDS);
  elements.forEach((e, i) => {
    const k = KINDS[e.kind];
    let r;
    switch (e.type) {
      case 'box': r = [1, k, e.x, e.y, e.w, e.d, e.h, 0, 0]; break;
      case 'gable': r = [2, k, e.x, e.y, e.w, e.d, e.eave, e.ridge, e.ridgeRuns === 'north-south' ? 1 : 0]; break;
      case 'hip': r = [3, k, e.x, e.y, e.w, e.d, e.eave, e.ridge, 0]; break;
      case 'tank': r = [4, k, e.x, e.y, e.r, e.h, 0, 0, 0]; break;
      case 'tree': r = [5, 3, e.x, e.y, e.r, e.base, e.top, 0, 0]; break;
      case 'pole': r = [6, k, e.x, e.y, e.h, 0, 0, 0, 0]; break;
      default: r = [7, 4, e.x, e.y, e.length, 0, 0, 0, 0];
    }
    rows.set(r, i * FIELDS);
  });
  return rows;
}

export async function loadExample(id) {
  if (!Object.hasOwn(EXAMPLES, id)) throw new PlanError('unknown example');
  const res = await fetch(`assets/examples/${id}.json`);
  if (!res.ok) throw new PlanError('the example could not be loaded');
  return parseBuilding(await res.text());
}

// ---------- Lightning where you are ----------

// Ground flash density from thunder days (Kuleshov et al., for Australia): Ng = 0.012 Td^1.4.
export const ngFromThunderDays = (td) => 0.012 * Math.pow(td, 1.4);

// ---------- Formats ----------

export const dollars = (d) => `$${Math.round(d).toLocaleString('en-AU')}`;
export const pct = (f) => (f >= 0.995 ? '100%' : f < 0.005 && f > 0 ? '<1%' : `${Math.round(f * 100)}%`);
export function years(perYear) {
  if (!(perYear > 0)) return 'never';
  const y = 1 / perYear;
  if (y < 2) return `${y.toFixed(1)} years`;
  if (y < 1000) return `${Math.round(y).toLocaleString('en-AU')} years`;
  return `${(Math.round(y / 100) * 100).toLocaleString('en-AU')} years`;
}
export function perCentury(perYear) {
  const v = perYear * 100;
  return v >= 10 ? Math.round(v).toString() : v >= 1 ? v.toFixed(1) : v >= 0.01 ? v.toFixed(2) : v > 0 ? '<0.01' : '0';
}
// "House" -> "house", but "TV antenna" stays as it is.
export const lowerFirst = (s) => (s.length > 1 && s[1] === s[1].toLowerCase() ? s[0].toLowerCase() + s.slice(1) : s);
export const metres = (m) => `${m.toFixed(m < 10 ? 1 : 0)} m`;

// ---------- Hand-off between pages (this tab only) ----------

const KEY = 'rodwise-choice';
export function saveChoice(choice) {
  try {
    const s = JSON.stringify(choice);
    if (s.length < MAX_FILE * 2) sessionStorage.setItem(KEY, s);
  } catch {
    /* storage may be off: the next page starts from the example house */
  }
}
export function loadChoice() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw || raw.length > MAX_FILE * 2) return null;
    const c = JSON.parse(raw);
    if (!c || typeof c !== 'object') return null;
    const level = LEVELS.some((l) => l.id === c.level) ? c.level : 'III';
    const td = typeof c.td === 'number' && c.td >= 1 && c.td <= 100 ? c.td : 25;
    const building = checkBuilding(c.building);
    return { building, level, td, example: Object.hasOwn(EXAMPLES, c.example) ? c.example : null };
  } catch {
    return null;
  }
}

export function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) e.append(c);
  return e;
}

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
