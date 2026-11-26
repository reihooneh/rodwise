// How it works: a sphere rolling over a cross-section (worked out here in 2D with the same
// dilation-and-closing as the 3D model), and charts from the C core.
import { ask } from './engine.js';

const NS = 'http://www.w3.org/2000/svg';
const $ = (id) => document.getElementById(id);
function svg(tag, attrs = {}, text) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
}

// ---------- The cross-section ----------

// A house 10 m across with 6 m walls and an 8.5 m ridge, a 3 m garage beside it, and an optional rod.
function profileHeights(xs, rod) {
  return xs.map((x) => {
    let h = 0;
    if (x >= 0 && x <= 10) h = 6 + 2.5 * (1 - Math.abs(x - 5) / 5);
    if (x > 10 && x <= 15) h = 3;
    if (rod > 0 && Math.abs(x - 5) < 0.06) h = 8.5 + rod;
    return h;
  });
}

function drawProfile() {
  const R = Number($('p-r').value), rod = Number($('p-rod').value), pos = Number($('p-pos').value) / 100;
  $('p-rod-out').textContent = rod > 0 ? `${rod.toFixed(1)} m` : 'none';
  $('p-pos-out').textContent = `${Math.round(pos * 100)}%`;
  const dx = 0.05, lo = -R - 4, hi = 15 + R + 4;
  const xs = [];
  for (let x = lo; x <= hi + 1e-9; x += dx) xs.push(x);
  const h = profileHeights(xs, rod);
  const n = xs.length, k = Math.round(R / dx);
  const cap = [];
  for (let d = 0; d <= k; d++) cap.push(Math.sqrt(Math.max(0, R * R - (d * dx) ** 2)));
  // Dilation: the lowest centre height over each x. Then the closing: the lowest underside.
  const centre = new Float64Array(n).fill(R);
  for (let s = 0; s < n; s++) {
    if (h[s] <= 0) continue;
    for (let d = -k; d <= k; d++) {
      const c = s + d;
      if (c >= 0 && c < n) centre[c] = Math.max(centre[c], h[s] + cap[Math.abs(d)]);
    }
  }
  const under = new Float64Array(n).fill(Infinity);
  for (let p = 0; p < n; p++) {
    if (h[p] <= 0) { under[p] = 0; continue; }
    for (let d = -k; d <= k; d++) {
      const c = p + d;
      if (c >= 0 && c < n) under[p] = Math.min(under[p], centre[c] - cap[Math.abs(d)]);
    }
  }
  // Drawing: a window round the house; the sphere is far bigger, so only its lower part shows.
  const W = 800, H = 340, pad = 18;
  const vx0 = -14, vx1 = 29, ymax = 19;
  const s = Math.min((W - 2 * pad) / (vx1 - vx0), (H - 2 * pad) / ymax);
  const ox = (W - (vx1 - vx0) * s) / 2, gy = H - pad;
  const X = (x) => ox + (x - vx0) * s, Y = (y) => gy - y * s;
  const g = $('profile');
  g.replaceChildren();
  // Protected zone: between the roof and the sphere's underside.
  let zone = '';
  for (let p = 0; p < n; p++) if (h[p] > 0) zone += `${zone ? 'L' : 'M'}${X(xs[p]).toFixed(1)},${Y(Math.min(under[p], ymax)).toFixed(1)} `;
  for (let p = n - 1; p >= 0; p--) if (h[p] > 0) zone += `L${X(xs[p]).toFixed(1)},${Y(h[p]).toFixed(1)} `;
  if (zone) g.append(svg('path', { class: 'zone', d: `${zone}Z` }));
  // The building.
  let outline = `M${X(0)},${Y(0)} `;
  for (let p = 0; p < n; p++) if (xs[p] >= 0 && xs[p] <= 15) outline += `L${X(xs[p]).toFixed(1)},${Y(Math.min(h[p], 8.5)).toFixed(1)} `;
  outline += `L${X(15)},${Y(0)} Z`;
  g.append(svg('path', { class: 'building', d: outline }));
  g.append(svg('line', { class: 'ground', x1: 0, y1: gy, x2: W, y2: gy }));
  if (rod > 0) g.append(svg('line', { class: 'rod', x1: X(5), y1: Y(8.5), x2: X(5), y2: Y(8.5 + rod) }));
  // Exposed roof: where the closing meets the roof.
  let seg = '', exposedLen = 0, roofLen = 0;
  for (let p = 1; p < n; p++) {
    if (h[p] <= 0 || h[p - 1] <= 0) continue;
    const both = under[p] - h[p] < 0.002 && under[p - 1] - h[p - 1] < 0.002;
    roofLen += dx;
    if (both && !(rod > 0 && Math.abs(xs[p] - 5) < 0.1)) {
      exposedLen += dx;
      seg += `M${X(xs[p - 1]).toFixed(1)},${Y(Math.min(h[p - 1], 8.5)).toFixed(1)}L${X(xs[p]).toFixed(1)},${Y(Math.min(h[p], 8.5)).toFixed(1)}`;
    }
  }
  if (seg) g.append(svg('path', { class: 'exposed', d: seg }));
  // The sphere at the chosen place along its path.
  const at = Math.round(pos * (n - 1));
  const cx = xs[at], cy = centre[at];
  g.append(svg('circle', { class: 'sphere', cx: X(cx).toFixed(1), cy: Y(cy).toFixed(1), r: (R * s).toFixed(1) }));
  // Where it touches: the point of the building or ground nearest the centre.
  let best = Infinity, tx = cx, ty = 0;
  for (let p = Math.max(0, at - k); p <= Math.min(n - 1, at + k); p++) {
    const d = Math.hypot(xs[p] - cx, h[p] - cy);
    if (d < best) { best = d; tx = xs[p]; ty = h[p]; }
  }
  g.append(svg('circle', { class: 'touch', cx: X(tx).toFixed(1), cy: Y(ty).toFixed(1), r: 5 }));
  const share = roofLen > 0 ? exposedLen / roofLen : 0;
  $('p-caption').textContent = rod > 0
    ? `With a ${rod.toFixed(1)} m rod, the ${R} m sphere still touches ${Math.round(share * 100)}% of the roof line. A rod protects out to about √(L(2R − L)) = ${Math.sqrt(rod * (2 * R - rod)).toFixed(1)} m on level ground.`
    : `Without a rod, the ${R} m sphere touches ${Math.round(share * 100)}% of the roof line: all of the main roof, while the low garage sits in the house's shelter.`;
}

for (const id of ['p-r', 'p-rod', 'p-pos']) $(id).addEventListener('input', drawProfile);
drawProfile();

// ---------- Charts ----------

function axes(g, W, H, m, xt, yt, xl, yl) {
  g.append(svg('line', { class: 'axis', x1: m.l, y1: H - m.b, x2: W - m.r, y2: H - m.b }));
  g.append(svg('line', { class: 'axis', x1: m.l, y1: m.t, x2: m.l, y2: H - m.b }));
  for (const [v, x] of xt) {
    g.append(svg('line', { class: 'grid', x1: x, y1: m.t, x2: x, y2: H - m.b }));
    g.append(svg('text', { x, y: H - m.b + 16, 'text-anchor': 'middle' }, v));
  }
  for (const [v, y] of yt) {
    g.append(svg('line', { class: 'grid', x1: m.l, y1: y, x2: W - m.r, y2: y }));
    g.append(svg('text', { x: m.l - 6, y: y + 4, 'text-anchor': 'end' }, v));
  }
  g.append(svg('text', { x: (m.l + W - m.r) / 2, y: H - 4, 'text-anchor': 'middle' }, xl));
  g.append(svg('text', { x: 8, y: 14 }, yl));
}

function logChart(id, kA, ys, ymax, yfmt, ylabel, marks) {
  const g = $(id);
  g.replaceChildren();
  const W = 420, H = 260, m = { l: 48, r: 14, t: 34, b: 42 };
  const lx = (v) => m.l + ((Math.log10(v) - Math.log10(2)) / (Math.log10(200) - Math.log10(2))) * (W - m.l - m.r);
  const ly = (v) => H - m.b - (v / ymax) * (H - m.t - m.b);
  axes(g, W, H, m, [2, 5, 10, 20, 50, 100, 200].map((v) => [String(v), lx(v)]), [0, 0.25, 0.5, 0.75, 1].map((f) => [yfmt(f * ymax), ly(f * ymax)]), 'Peak current (kA)', ylabel);
  g.append(svg('path', { class: 'line-bolt', d: kA.map((v, i) => `${i ? 'L' : 'M'}${lx(v).toFixed(1)},${ly(ys[i]).toFixed(1)}`).join('') }));
  for (const [v, y, label] of marks) {
    g.append(svg('circle', { class: 'dot-cover', cx: lx(v), cy: ly(y), r: 4 }));
    g.append(svg('text', { x: lx(v) + 7, y: ly(y) + (label === 'IV' ? 14 : -6) }, label));
  }
}

async function charts() {
  const c = await ask('curves');
  const lv = [[3, 'I'], [5, 'II'], [10, 'III'], [16, 'IV']];
  const at = (kA) => c.exceed[Math.max(0, c.kA.findIndex((v) => v >= kA))];
  logChart('c-current', c.kA, c.exceed, 1, (v) => `${Math.round(v * 100)}%`, 'Share at least this strong', lv.map(([kA, id]) => [kA, at(kA), id]));
  logChart('c-distance', c.kA, c.distance, 300, (v) => `${Math.round(v)} m`, 'Striking distance',
    lv.map(([kA, id]) => [kA, 10 * Math.pow(kA, 0.65), id]));

  const heights = [3, 6, 9, 12, 16, 20, 25, 30];
  const a = await ask('area', { L: 20, W: 10, heights, leaders: 80000 });
  const g = $('c-area');
  g.replaceChildren();
  const W = 640, H = 280, m = { l: 64, r: 16, t: 34, b: 42 };
  const ymax = Math.ceil(Math.max(...a.points.map((p) => Math.max(p.egm, p.iec))) / 5000) * 5000;
  const lx = (v) => m.l + (v / 30) * (W - m.l - m.r), ly = (v) => H - m.b - (v / ymax) * (H - m.t - m.b);
  axes(g, W, H, m, [0, 5, 10, 15, 20, 25, 30].map((v) => [String(v), lx(v)]), [0, 0.25, 0.5, 0.75, 1].map((f) => [`${Math.round((f * ymax) / 1000)}k`, ly(f * ymax)]), 'Building height (m)', 'Collection area (m²)');
  g.append(svg('path', { class: 'line-bolt', d: a.points.map((p, i) => `${i ? 'L' : 'M'}${lx(p.H)},${ly(p.egm)}`).join('') }));
  g.append(svg('path', { class: 'line-cover', d: a.points.map((p, i) => `${i ? 'L' : 'M'}${lx(p.H)},${ly(p.iec)}`).join('') }));
  for (const p of a.points) {
    g.append(svg('circle', { class: 'dot-bolt', cx: lx(p.H), cy: ly(p.egm), r: 3.5 }));
    g.append(svg('circle', { class: 'dot-cover', cx: lx(p.H), cy: ly(p.iec), r: 3.5 }));
  }
}

charts().catch(() => {
  for (const id of ['c-current', 'c-distance', 'c-area']) $(id).append(svg('text', { x: 20, y: 40 }, 'The charts could not be drawn in this browser.'));
}).finally(() => { document.body.dataset.ready = '1'; });
