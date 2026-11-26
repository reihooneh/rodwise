// The WebAssembly build, driven from Node as the page drives it: the examples, the levels, hostile
// numbers, and the page's own checks on building files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { checkBuilding, parseBuilding, toRows, PlanError } from '../../site/assets/js/common.js';

const root = new URL('../../', import.meta.url);
const { instance } = await WebAssembly.instantiate(readFileSync(new URL('site/assets/rodwise.wasm', root)), {});
const w = instance.exports;
const put = (rows) => new Float64Array(w.memory.buffer, w.rw_w_elements(), 120 * 9).set(rows);
const info = () => new Float64Array(w.memory.buffer, w.rw_w_info(), 15);
const examples = Object.fromEntries(readdirSync(new URL('examples/', root)).map((f) => [f.replace('.json', ''), parseBuilding(readFileSync(new URL(`examples/${f}`, root), 'utf8'))]));

test('every example builds, and a smaller sphere reaches at least as much', () => {
  for (const [id, b] of Object.entries(examples)) {
    const rows = toRows(b.elements);
    let last = Infinity;
    for (const R of [20, 30, 45, 60]) {
      put(rows);
      assert.equal(w.rw_w_scene(b.elements.length, R), 0, `${id} at ${R} m`);
      const exposed = info()[5];
      assert.ok(exposed <= last, `${id}: ${R} m sphere touches ${exposed}, more than the smaller one's ${last}`);
      last = exposed;
    }
  }
});

test('only the tall buildings can take side flashes, and only with small spheres', () => {
  for (const [id, b] of Object.entries(examples)) {
    for (const R of [20, 60]) {
      put(toRows(b.elements));
      w.rw_w_scene(b.elements.length, R);
      assert.equal(info()[9] > 0, (id === 'flats' || id === 'church') && R === 20, `${id} at ${R} m: ${info()[9]} tall-wall cells`);
    }
  }
});

test('the planner protects every example at every level, except steep spires and tall edges against small spheres', () => {
  for (const [id, b] of Object.entries(examples)) {
    for (const R of [20, 30, 45, 60]) {
      put(toRows(b.elements));
      assert.equal(w.rw_w_plan(b.elements.length, R, 0.6, 450, 1.5, 650, 3, 1100, 3, 2), 0, `${id} ${R}`);
      const out = new Float64Array(w.memory.buffer, w.rw_w_plan_out(), 7);
      if ((id === 'church' && R <= 30) || (id === 'flats' && R === 20)) {
        // A steep spire, and the roof edges of a block taller than the sphere, can't be kept clear
        // with short rods: the standard covers those with conductors run over the surface. The page
        // says so; the plan must still help.
        assert.ok(out[3] < out[2], `${id} at ${R} m: ${out[3]} of ${out[2]} still exposed`);
      } else {
        assert.equal(out[3], 0, `${id} at ${R} m: ${out[3]} cells still exposed`);
      }
    }
  }
});

test('the rates scale: strikes to the building rise with its height', () => {
  const rate = (h) => {
    put(new Float64Array([1, 1, 0, 0, 20, 10, h, 0, 0]));
    w.rw_w_scene(1, 45);
    w.rw_w_strikes(80000, 3);
    return new Float64Array(w.memory.buffer, w.rw_w_rates(), 5)[1];
  };
  const a = rate(5), b = rate(15), c = rate(30);
  assert.ok(a < b && b < c, `${a} ${b} ${c}`);
});

test('hostile numbers are refused at the WebAssembly boundary', () => {
  const bad = [
    [1, 1, NaN, 0, 5, 5, 3, 0, 0], [1, 1, 0, 0, 5, 5, Infinity, 0, 0], [1, 1, 0, 0, 5, 5, -1, 0, 0],
    [9, 1, 0, 0, 5, 5, 3, 0, 0], [1, 7, 0, 0, 5, 5, 3, 0, 0], [7, 4, 0, 0, 1e9, 0, 0, 0, 0],
  ];
  for (const r of bad) {
    put(new Float64Array(r));
    assert.notEqual(w.rw_w_scene(1, 45), 0, `accepted ${r}`);
  }
  put(new Float64Array([1, 1, 0, 0, 5, 5, 3, 0, 0]));
  assert.notEqual(w.rw_w_scene(0, 45), 0, 'no elements');
  assert.notEqual(w.rw_w_scene(81, 45), 0, 'too many elements');
  assert.notEqual(w.rw_w_scene(1, NaN), 0, 'radius NaN');
  assert.notEqual(w.rw_w_scene(1, 500), 0, 'radius too big');
  assert.ok(w.rw_w_strikes(10, 1) < 0, 'too few leaders refused');
  assert.ok(w.rw_w_plan(1, 45, 0.6, 0, 1.5, 650, 3, 1100, 3, 2) < 0, 'zero cost refused');
  assert.ok(w.rw_w_plan(1, 45, 0.6, 450, 1.5, 650, 3, 1100, 9, 2) < 0, 'too many lengths refused');
});

test('the page refuses bad building files before the model sees them', () => {
  const bad = [
    null, [], {}, { elements: [] }, { elements: 'x' },
    { elements: [{ type: 'box', x: 0, y: 0, w: 5, d: 5 }] },
    { elements: [{ type: 'castle', x: 0, y: 0 }] },
    { elements: [{ type: 'box', kind: 'admin', x: 0, y: 0, w: 5, d: 5, h: 3 }] },
    { elements: [{ type: 'box', x: 99, y: 0, w: 5, d: 5, h: 3 }] },
    { elements: [{ type: 'gable', x: 0, y: 0, w: 5, d: 5, eave: 4, ridge: 3 }] },
    { elements: [{ type: 'gable', x: 0, y: 0, w: 5, d: 5, eave: 3, ridge: 4, ridgeRuns: 'up' }] },
    { name: '<script>', elements: [{ type: 'box', x: 0, y: 0, w: 5, d: 5, h: 3 }] },
    { elements: [{ type: 'box', name: 'a\u001b[2J', x: 0, y: 0, w: 5, d: 5, h: 3 }] },
    { elements: [{ type: 'box', x: '0', y: 0, w: 5, d: 5, h: 3 }] },
    { elements: Array.from({ length: 81 }, () => ({ type: 'pole', x: 0, y: 0, h: 3 })) },
  ];
  for (const b of bad) assert.throws(() => checkBuilding(b), PlanError, JSON.stringify(b)?.slice(0, 80));
  assert.throws(() => parseBuilding('{'), PlanError);
  assert.throws(() => parseBuilding(' '.repeat(70000)), PlanError);
  // A prototype-polluting key is just an unknown field.
  const b = parseBuilding('{"__proto__": {"admin": true}, "elements": [{"type": "box", "x": 0, "y": 0, "w": 5, "d": 5, "h": 3}]}');
  assert.equal(b.elements.length, 1);
  assert.equal({}.admin, undefined);
});
