// Home: the example house in 3D with strikes landing, and its numbers worked out live.
import { ask } from './engine.js';
import { dollars, loadExample, ngFromThunderDays, pct, perCentury, toRows } from './common.js';
import { setupStage } from './stageui.js';

const ui = setupStage();
const set = (id, v) => { document.getElementById(id).textContent = v; };

async function main() {
  const building = await loadExample('house');
  const rows = toRows(building.elements);
  const ng = ngFromThunderDays(25);
  const res = await ask('check', { rows, radius: 45, leaders: 60000, seed: 7 });
  ui.show(building, res.scene, res.egm.strikes);
  const r = res.egm.rates;
  const toBuilding = (r[1] + r[2]) * ng;
  set('t-strikes', perCentury(toBuilding));
  const antenna = building.elements.findIndex((e) => e.name === 'TV antenna');
  set('t-antenna', antenna >= 0 && r[1] + r[2] > 0 ? pct(res.egm.elementRates[antenna] / (r[1] + r[2])) : '–');
  const info = res.scene.info;
  set('t-exposed', pct(info.exposedCells / Math.max(1, info.protectCells)));
  const plan = await ask('plan', { rows, radius: 45, lengths: [0.6, 1.5, 3], costs: [450, 650, 1100], spacing: 2 });
  set('t-plan', dollars(plan.totalCost));
  document.body.dataset.ready = '1';
}

main().catch(() => {
  for (const id of ['t-strikes', 't-antenna', 't-exposed', 't-plan']) set(id, '–');
  document.body.dataset.ready = '1';
});
