// Runs the C core (WebAssembly) off the page's main thread. Messages in: {id, op, ...}; out:
// {id, ok, ...} with copies of the results (the module's memory is never shared).
let wasm = null;
let mem = null;

async function ready() {
  if (wasm) return;
  const res = await fetch(new URL('../rodwise.wasm', import.meta.url));
  const { instance } = await WebAssembly.instantiate(await res.arrayBuffer(), {});
  wasm = instance.exports;
  mem = wasm.memory.buffer;
}

const MAX_ROWS = 120;
function putElements(rows) {
  if (!(rows instanceof Float64Array) || rows.length % 9 !== 0 || rows.length / 9 > MAX_ROWS) throw new Error('bad elements');
  new Float64Array(mem, wasm.rw_w_elements(), MAX_ROWS * 9).set(rows);
  return rows.length / 9;
}

function scene(rows, radius) {
  const n = putElements(rows);
  const rc = wasm.rw_w_scene(n, radius);
  if (rc !== 0) throw new Error(`the building could not be modelled (${rc})`);
  const info = new Float64Array(mem, wasm.rw_w_info(), 15).slice();
  const cells = info[0] * info[1];
  return {
    info: {
      nx: info[0], ny: info[1], cell: info[2], x0: info[3], y0: info[4], exposedCells: info[5], protectCells: info[6],
      exposedArea: info[7], protectArea: info[8], tallWalls: info[9], top: info[10], minx: info[11], miny: info[12],
      maxx: info[13], maxy: info[14], radius,
    },
    h: new Float32Array(mem, wasm.rw_w_heights(), cells).slice(),
    kind: new Uint8Array(mem, wasm.rw_w_kinds(), cells).slice(),
    owner: new Int16Array(mem, wasm.rw_w_owner(), cells).slice(),
    centre: new Float32Array(mem, wasm.rw_w_centre(), cells).slice(),
    under: new Float32Array(mem, wasm.rw_w_under(), cells).slice(),
  };
}

function strikes(leaders, seed, cells) {
  const shown = wasm.rw_w_strikes(leaders, seed);
  if (shown < 0) throw new Error('the strikes could not be simulated');
  const size = wasm.rw_w_strike_size();
  const view = new DataView(mem, wasm.rw_w_shown(), shown * size);
  const list = [];
  for (let k = 0; k < shown; k++) {
    const o = k * size;
    list.push({
      x: view.getFloat32(o, true), y: view.getFloat32(o + 4, true), z: view.getFloat32(o + 8, true),
      current: view.getFloat32(o + 12, true), kind: view.getInt16(o + 16, true), element: view.getInt16(o + 18, true),
    });
  }
  return {
    rates: Array.from(new Float64Array(mem, wasm.rw_w_rates(), 5)),
    maxFailure: wasm.rw_w_max_failure(),
    elementRates: Array.from(new Float64Array(mem, wasm.rw_w_element_rates(), 120)),
    density: new Float32Array(mem, wasm.rw_w_density(), cells).slice(),
    strikes: list,
  };
}

self.onmessage = async (ev) => {
  const { id, op } = ev.data || {};
  try {
    await ready();
    let out;
    if (op === 'check') {
      // Rolling sphere and strikes together, for one building at one level.
      const s = scene(ev.data.rows, ev.data.radius);
      const k = strikes(ev.data.leaders || 60000, ev.data.seed || 1, s.info.nx * s.info.ny);
      out = { scene: s, egm: k };
    } else if (op === 'plan') {
      const n = putElements(ev.data.rows);
      const [l, c] = [ev.data.lengths, ev.data.costs];
      const rc = wasm.rw_w_plan(n, ev.data.radius, l[0], c[0], l[1], c[1], l[2], c[2], 3, ev.data.spacing);
      if (rc !== 0) throw new Error(`the plan could not be made (${rc})`);
      const o = new Float64Array(mem, wasm.rw_w_plan_out(), 7 + 4 * 40).slice();
      const rods = [];
      for (let k = 0; k < o[0]; k++) rods.push({ x: o[7 + 4 * k], y: o[8 + 4 * k], length: o[9 + 4 * k], cost: o[10 + 4 * k] });
      out = { rods, totalCost: o[1], exposedBefore: o[2], exposedAfter: o[3], candidates: o[4], evaluations: o[5], complete: o[6] === 1 };
    } else if (op === 'curves') {
      // For the method page: the current distribution and striking distance.
      const kA = [];
      for (let i = 2; i <= 200; i *= 1.08) kA.push(i);
      out = {
        kA,
        exceed: kA.map((i) => wasm.rw_w_current_exceeds(i)),
        distance: kA.map((i) => wasm.rw_w_striking_distance(i)),
      };
    } else if (op === 'area') {
      // The electrogeometric collection area of a lone box, against IEC 62305-2.
      const out2 = [];
      for (const H of ev.data.heights) {
        const rows = new Float64Array([1, 1, 0, 0, ev.data.L, ev.data.W, H, 0, 0]);
        scene(rows, 20);
        const k = strikes(ev.data.leaders || 80000, 3, 0);
        out2.push({ H, egm: (k.rates[1] * 1e6), iec: wasm.rw_w_iec_area(ev.data.L, ev.data.W, H) });
      }
      out = { points: out2 };
    } else {
      throw new Error('unknown request');
    }
    self.postMessage({ id, ok: true, ...out });
  } catch (e) {
    self.postMessage({ id, ok: false, error: String(e && e.message ? e.message : e) });
  }
};
