// The building from above: every cell of the model, coloured by the rolling sphere, with where the
// simulated strikes landed drawn over it. Drawn on a canvas (no text inside it; the legend is HTML).
const EXPOSED = [255, 107, 87], NEAR = [122, 184, 255], FAR = [61, 95, 174], TREE = [63, 143, 90], ROD = [255, 211, 122];
const GROUND = [18, 22, 42], STRIKE = [243, 246, 255];

function mix(a, b, f) {
  return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * f));
}

export function drawPlan(canvas, g, egm, rods = []) {
  const { nx, ny, cell, x0, y0, minx, miny, maxx, maxy } = g.info;
  // Frame the building with a little ground round it.
  const pad = 4;
  const i0 = Math.max(0, Math.floor((minx - pad - x0) / cell)), i1 = Math.min(nx - 1, Math.ceil((maxx + pad - x0) / cell));
  const j0 = Math.max(0, Math.floor((miny - pad - y0) / cell)), j1 = Math.min(ny - 1, Math.ceil((maxy + pad - y0) / cell));
  const w = i1 - i0 + 1, h = j1 - j0 + 1;
  const box = canvas.parentElement.clientWidth || 600;
  const scale = Math.max(1, Math.floor(Math.min(box / w, 520 / h)));
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  let maxD = 0;
  if (egm) for (let c = 0; c < egm.density.length; c++) maxD = Math.max(maxD, egm.density[c]);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const c = j * nx + i;
      let col = GROUND;
      const k = g.kind[c];
      if (k === 1 || k === 2) {
        const m = g.under[c] - g.h[c];
        col = m <= 0.005 ? EXPOSED : mix(NEAR, FAR, Math.min(1, m / 3));
        // Shade by height so roof shapes read.
        col = mix(col, [0, 0, 0], Math.max(0, 0.35 - (g.h[c] / (g.info.top || 1)) * 0.35));
      } else if (k === 3) col = TREE;
      else if (k === 4) col = ROD;
      if (egm && maxD > 0 && egm.density[c] > 0) col = mix(col, STRIKE, Math.min(1, 0.35 + 0.65 * Math.sqrt(egm.density[c] / maxD)));
      // Image rows run top-down; north is up.
      const o = ((j1 - j) * w + (i - i0)) * 4;
      img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
    }
  }
  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  tmp.getContext('2d').putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, w * scale, h * scale);
  for (const r of rods) {
    const px = ((r.x - x0) / cell - i0) * scale, py = (j1 + 1 - (r.y - y0) / cell) * scale;
    ctx.beginPath();
    ctx.arc(px, py, Math.max(4, scale * 1.2), 0, Math.PI * 2);
    ctx.fillStyle = 'rgb(255, 211, 122)';
    ctx.strokeStyle = 'rgb(9, 11, 22)';
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
  }
  canvas.setAttribute('aria-label', `Plan view: ${g.info.exposedCells} of ${g.info.protectCells} roof cells can be struck`);
}
