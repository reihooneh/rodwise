// Protect it: plan the air terminals, then check the plan with the sphere and the strikes again.
import { ask } from './engine.js';
import { dollars, el, levelById, lowerFirst, loadChoice, loadExample, ngFromThunderDays, pct, perCentury, saveChoice, toRows } from './common.js';
import { drawPlan } from './planview.js';
import { setupStage } from './stageui.js';

const $ = (id) => document.getElementById(id);
const ui = setupStage();
const state = { building: null, example: 'house', level: 'III', td: 25 };

function showLevel() {
  for (const b of $('levels').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.level === state.level));
}

// The rod options, checked: lengths 0.2 to 10 m and rising, costs $1 to $1,000,000.
function options() {
  const lengths = [0, 1, 2].map((k) => Number($(`l${k}`).value));
  const costs = [0, 1, 2].map((k) => Number($(`c${k}`).value));
  if (!lengths.every((l) => Number.isFinite(l) && l >= 0.2 && l <= 10)) throw new Error('rod lengths must be 0.2 to 10 m');
  if (!(lengths[0] < lengths[1] && lengths[1] < lengths[2])) throw new Error('make each rod longer than the one before');
  if (!costs.every((c) => Number.isFinite(c) && c >= 1 && c <= 1e6)) throw new Error('costs must be $1 to $1,000,000');
  return { lengths, costs, spacing: Number($('spacing').value) };
}

// Where a rod stands, in words: the part under it, and how far along.
function describe(rod, scene, building) {
  const { nx, ny, cell, x0, y0 } = scene.info;
  const i = Math.floor((rod.x - x0) / cell), j = Math.floor((rod.y - y0) / cell);
  const o = i >= 0 && j >= 0 && i < nx && j < ny ? scene.owner[j * nx + i] : -1;
  const e = building.elements[o];
  if (!e) return 'on the roof';
  if (e.type === 'pole') return `on top of the ${lowerFirst(e.name)}`;
  if (e.type === 'tank') return `on the ${lowerFirst(e.name)}`;
  if (e.w) {
    const fromW = rod.x - e.x, fromS = rod.y - e.y;
    const away = (m, side) => (m < 0.3 ? `at the ${side}` : `${m.toFixed(1)} m from the ${side}`);
    const ew = fromW <= e.w / 2 ? away(fromW, 'west end') : away(e.w - fromW, 'east end');
    const ns = fromS <= e.d / 2 ? away(fromS, 'south side') : away(e.d - fromS, 'north side');
    return `on the ${lowerFirst(e.name)}, ${ew}, ${ns}`;
  }
  return `on the ${lowerFirst(e.name)}`;
}

async function run() {
  $('error').textContent = '';
  if (!state.building) return;
  let opt;
  try {
    opt = options();
  } catch (e) {
    $('error').textContent = `Check the air terminals: ${e.message}.`;
    return;
  }
  $('run').disabled = true;
  $('status').textContent = 'Trying air terminals across the roof…';
  try {
    const level = levelById(state.level);
    const b = state.building;
    const rows = toRows(b.elements);
    const plan = await ask('plan', { rows, radius: level.radius, ...opt });
    $('status').textContent = 'Checking the plan with the sphere and the strikes…';
    const before = await ask('check', { rows, radius: level.radius, leaders: 60000, seed: 7 });
    const withRods = b.elements.concat(plan.rods.map((r, k) => ({ type: 'rod', kind: 'terminal', name: `Air terminal ${k + 1}`, x: r.x, y: r.y, length: r.length })));
    const after = await ask('check', { rows: toRows(withRods), radius: level.radius, leaders: 60000, seed: 7 });
    render(plan, before, after, level, withRods);
    saveChoice({ building: { name: b.name, about: b.about, elements: b.elements }, level: state.level, td: state.td, example: state.example });
    $('status').textContent = `Weighed ${plan.evaluations.toLocaleString('en-AU')} options at ${plan.candidates} places.`;
  } catch (e) {
    $('status').textContent = '';
    $('error').textContent = `Couldn't plan this building: ${e.message}`;
  } finally {
    $('run').disabled = false;
    document.body.dataset.runs = String(Number(document.body.dataset.runs || 0) + 1);
    document.body.dataset.ready = '1';
  }
}

function render(plan, before, after, level, withRods) {
  const ng = ngFromThunderDays(state.td);
  const b = state.building;
  const sb = (before.egm.rates[1] + before.egm.rates[2]) * ng, sa = (after.egm.rates[1] + after.egm.rates[2]) * ng;
  const ib = before.scene.info, ia = after.scene.info;
  $('f-before').textContent = pct(ib.exposedCells / Math.max(1, ib.protectCells));
  $('f-after').textContent = pct(ia.exposedCells / Math.max(1, ia.protectCells));
  $('f-sbefore').textContent = perCentury(sb);
  $('f-safter').textContent = perCentury(sa);
  const n = plan.rods.length;
  $('headline').textContent = n === 0 && plan.exposedAfter === 0
    ? `Nothing on this building is within the ${level.radius} m sphere's reach: no air terminals needed at level ${level.id}.`
    : plan.exposedAfter === 0
      ? `${n} air terminal${n === 1 ? '' : 's'} for ${dollars(plan.totalCost)} leave${n === 1 ? 's' : ''} nothing on the roof for a ${level.radius} m sphere to touch.`
      : `${n} air terminal${n === 1 ? '' : 's'} for ${dollars(plan.totalCost)} protect most of the building, but rods alone can't keep a ${level.radius} m sphere off all of it.`;
  const slip = after.egm.maxFailure;
  $('slip').textContent = sa > 0
    ? `A few strikes still get past to the roof: the weak ones, whose short striking distance lets them slip between the rods. In this simulation the largest was ${slip.toFixed(1)} kA; level ${level.id} is designed to intercept everything from ${level.current} kA up, about ${Math.round(level.intercept * 100)}% of strikes.`
    : 'No simulated strike reached the roof or fittings past the rods.';
  const list = $('rods');
  list.replaceChildren();
  if (!n) list.append(el('li', { class: 'detail', text: 'No air terminals needed.' }));
  plan.rods.forEach((r) => {
    list.append(el('li', {},
      el('span', { text: `${r.length.toFixed(1)} m ${r.length >= 3 ? 'mast' : 'rod'}` }),
      el('span', { class: 'cost', text: dollars(r.cost) }),
      el('span', { class: 'detail', text: describe(r, before.scene, b) })));
  });
  if (!plan.complete) list.append(el('li', { class: 'detail', text: 'This site is big enough that the search stopped at its work limit (a few seconds) before trying everything. The rods above are checked and help, but a cheaper set may exist.' }));
  if (plan.exposedAfter > 0) list.append(el('li', { class: 'detail', text: `${(plan.exposedAfter * 0.25).toFixed(1)} m² of steep or tall surface is still within the sphere's reach. The standard protects surfaces like that with conductors run over them (a mesh), or a taller mast nearby.` }));
  ui.show({ elements: withRods }, after.scene, after.egm.strikes, plan.rods);
  drawPlan($('plan'), after.scene, after.egm, plan.rods);
}

async function useExample(id) {
  state.example = id;
  state.building = await loadExample(id);
  $('example').value = id;
}

async function main() {
  $('form').addEventListener('submit', (e) => { e.preventDefault(); run(); });
  $('example').addEventListener('change', async () => {
    if ($('example').value === 'mine') return;
    await useExample($('example').value);
    run();
  });
  $('levels').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-level]');
    if (!btn) return;
    state.level = btn.dataset.level;
    showLevel();
    run();
  });
  $('spacing').addEventListener('input', () => { $('spacing-out').textContent = `${$('spacing').value} m`; });
  const saved = loadChoice();
  if (saved) {
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
  run();
}

main().catch((e) => { $('error').textContent = e.message; document.body.dataset.ready = '1'; });
