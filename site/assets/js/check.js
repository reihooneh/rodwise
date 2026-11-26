// Where it strikes: the rolling sphere and the simulated strikes for one building.
import { ask } from './engine.js';
import {
  EXAMPLES, KIND_NAMES, PlanError, el, levelById, loadChoice, loadExample, ngFromThunderDays, parseBuilding,
  lowerFirst, pct, perCentury, saveChoice, toRows, years, MAX_FILE,
} from './common.js';
import { drawPlan } from './planview.js';
import { setupStage } from './stageui.js';

const $ = (id) => document.getElementById(id);
const ui = setupStage();
const state = { building: null, example: 'house', level: 'III', td: 25 };

function showLevel() {
  for (const b of $('levels').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.level === state.level));
  const l = levelById(state.level);
  $('level-use').textContent = `A ${l.radius} m sphere. Stops ${Math.round(l.intercept * 100)}% of strikes (all of ${l.current} kA and above). For: ${l.use.toLowerCase()}.`;
}
function showTd() {
  $('td').value = String(state.td);
  $('td-out').textContent = String(state.td);
  $('ng-note').textContent = `About ${ngFromThunderDays(state.td).toFixed(2)} ground flashes per km² a year. Read thunder days for your area from the Bureau of Meteorology's thunder-day map.`;
}

function setBusy(on, msg = '') {
  $('run').disabled = on;
  $('status').textContent = msg;
}

async function run() {
  $('error').textContent = '';
  if (!state.building) return;
  setBusy(true, 'Rolling the sphere and sending the lightning down…');
  try {
    const level = levelById(state.level);
    const rows = toRows(state.building.elements);
    const res = await ask('check', { rows, radius: level.radius, leaders: 60000, seed: 7 });
    render(res, level);
    saveChoice({ building: { name: state.building.name, about: state.building.about, elements: state.building.elements }, level: state.level, td: state.td, example: state.example });
    setBusy(false, '');
    document.body.dataset.runs = String(Number(document.body.dataset.runs || 0) + 1);
    document.body.dataset.ready = '1';
  } catch (e) {
    setBusy(false, '');
    $('error').textContent = `Couldn't model this building: ${e.message}`;
    document.body.dataset.ready = '1';
  }
}

function render(res, level) {
  const { scene, egm } = res;
  const b = state.building;
  const ng = ngFromThunderDays(state.td);
  const r = egm.rates;
  const toBuilding = (r[1] + r[2]) * ng;
  const nearby = r[1] + r[2] + r[3] + r[4];
  ui.show(b, scene, egm.strikes);

  // Per part: how many of its cells the sphere touches, and its strikes.
  const parts = b.elements.map(() => ({ cells: 0, touched: 0 }));
  for (let c = 0; c < scene.h.length; c++) {
    const o = scene.owner[c];
    if (o < 0 || o >= parts.length) continue;
    parts[o].cells++;
    if (scene.under[c] - scene.h[c] <= 0.005) parts[o].touched++;
  }
  const tbody = $('parts');
  tbody.replaceChildren();
  let top = null;
  b.elements.forEach((e, i) => {
    const rate = egm.elementRates[i] * ng;
    if ((e.kind === 'building' || e.kind === 'fitting') && (!top || rate > top.rate)) top = { name: e.name, rate };
    const p = parts[i];
    const touch = p.cells ? p.touched / p.cells : 0;
    const pill = el('span', { class: `pill ${touch === 0 ? 'low' : touch < 0.5 ? 'mid' : 'high'}`, text: p.cells ? pct(touch) : '–' });
    const kindName = e.kind === 'building' ? 'Building' : KIND_NAMES[{ fitting: 2, tree: 3, terminal: 4 }[e.kind]];
    tbody.append(el('tr', {},
      el('td', { text: e.name }),
      el('td', { class: 'hide-sm', text: kindName }),
      el('td', { class: 'num', text: perCentury(rate) }),
      el('td', { class: 'num' }, e.kind === 'tree' || e.kind === 'terminal' ? el('span', { class: 'muted', text: 'not protected' }) : pill)));
  });

  const info = scene.info;
  const share = info.exposedCells / Math.max(1, info.protectCells);
  $('t-century').textContent = perCentury(toBuilding);
  $('t-years').textContent = years(toBuilding);
  $('t-exposed').textContent = pct(share);
  $('t-elsewhere').textContent = nearby > 0 ? pct((r[3] + r[4]) / nearby) : '–';
  const most = top && top.rate > 0 ? ` The ${lowerFirst(top.name)} would take the most.` : '';
  $('headline').textContent = `At level ${level.id} (a ${level.radius} m sphere), lightning can reach ${pct(share)} of the roof and fittings. With ${state.td} thunder days a year, expect a strike to the building about every ${years(toBuilding)}.${most}`;

  const tall = $('tall');
  if (info.tallWalls > 0) {
    tall.hidden = false;
    tall.replaceChildren(el('strong', { text: 'Side flashes. ' }), document.createTextNode(`Some walls rise more than ${level.radius} m above the ground or roof beside them, so the sphere can touch the walls too, not just the roof. The standard then asks for conductors on the upper walls as well.`));
  } else {
    tall.hidden = true;
  }
  drawPlan($('plan'), scene, egm);
}

async function useExample(id) {
  state.example = id;
  state.building = await loadExample(id);
  $('example').value = id;
}

function bind() {
  $('form').addEventListener('submit', (e) => { e.preventDefault(); run(); });
  $('example').addEventListener('change', async () => {
    try {
      await useExample($('example').value);
      run();
    } catch (e) {
      $('error').textContent = e.message;
    }
  });
  $('levels').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-level]');
    if (!b) return;
    state.level = b.dataset.level;
    showLevel();
    run();
  });
  $('td').addEventListener('input', () => {
    state.td = Number($('td').value);
    showTd();
  });
  $('td').addEventListener('change', run);
  const file = $('file'), drop = $('drop');
  async function take(f) {
    $('error').textContent = '';
    if (!f) return;
    if (f.size > MAX_FILE) { $('error').textContent = 'That file is larger than 64 KB.'; return; }
    try {
      state.building = parseBuilding(await f.text());
      state.example = null;
      const mine = $('example').querySelector('option[value=mine]');
      mine.disabled = false;
      mine.textContent = `My building: ${state.building.name}`;
      $('example').value = 'mine';
      run();
    } catch (e) {
      $('error').textContent = e instanceof PlanError ? `That file can't be used: ${e.message}.` : "That file can't be read.";
    }
  }
  file.addEventListener('change', () => take(file.files[0]));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); take(e.dataTransfer.files[0]); });
}

async function main() {
  bind();
  const fromUrl = new URLSearchParams(location.search).get('example');
  const saved = loadChoice();
  if (fromUrl && Object.hasOwn(EXAMPLES, fromUrl)) {
    await useExample(fromUrl);
  } else if (saved) {
    state.level = saved.level;
    state.td = saved.td;
    if (saved.example) await useExample(saved.example);
    else {
      state.building = saved.building;
      state.example = null;
      const mine = $('example').querySelector('option[value=mine]');
      mine.disabled = false;
      mine.textContent = `My building: ${saved.building.name}`;
      $('example').value = 'mine';
    }
  } else {
    await useExample('house');
  }
  showLevel();
  showTd();
  run();
}

main().catch((e) => { $('error').textContent = e.message; document.body.dataset.ready = '1'; });
