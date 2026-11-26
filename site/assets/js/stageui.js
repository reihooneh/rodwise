// The 3D stage with its play and sphere buttons, shared by the pages. Falls back quietly when
// WebGL is off.
import { createStage, hasWebGL } from './scene3d.js';
import { reducedMotion } from './common.js';

export function setupStage() {
  const box = document.getElementById('stage');
  const play = document.getElementById('play');
  const sphereBtn = document.getElementById('sphere');
  let stage = null;
  if (hasWebGL()) {
    try {
      stage = createStage(box);
    } catch {
      stage = null;
    }
  }
  if (!stage) {
    document.getElementById('fallback').hidden = false;
    play.hidden = true;
    sphereBtn.hidden = true;
  }
  if (reducedMotion()) {
    play.textContent = 'Play';
    play.setAttribute('aria-pressed', 'false');
  }
  play.addEventListener('click', () => {
    if (!stage) return;
    const on = stage.play(!stage.playing);
    play.textContent = on ? 'Pause' : 'Play';
    play.setAttribute('aria-pressed', String(on));
  });
  let last = null, showing = false;
  sphereBtn.addEventListener('click', () => {
    if (!stage || !last) return;
    showing = !showing;
    stage.setSphere(showing ? last.info.radius : 0, showing ? last : null);
    if (!showing) stage.frame(false);
    sphereBtn.setAttribute('aria-pressed', String(showing));
    sphereBtn.textContent = showing ? 'Hide the sphere' : 'Roll the sphere';
  });
  return {
    stage,
    show(building, scene, strikes, rods = []) {
      last = scene;
      if (!stage) return;
      stage.setBuilding(building);
      stage.setExposure(scene);
      stage.setRods(rods, (x, y) => heightAt(scene, x, y, rods));
      stage.setSphere(showing ? scene.info.radius : 0, showing ? scene : null);
      stage.setStrikes(strikes || []);
    },
  };
}

// The height a rod stands on: the model's cell there, less the rod itself if it is in the model.
export function heightAt(scene, x, y, rods = []) {
  const { nx, ny, cell, x0, y0 } = scene.info;
  const i = Math.floor((x - x0) / cell), j = Math.floor((y - y0) / cell);
  if (i < 0 || j < 0 || i >= nx || j >= ny) return 0;
  const c = j * nx + i;
  let h = scene.h[c];
  if (scene.kind[c] === 4) {
    // The cell holds a rod (or several): take their lengths off to find what it stands on.
    for (const r of rods) if (Math.floor((r.x - x0) / cell) === i && Math.floor((r.y - y0) / cell) === j) h -= r.length;
  }
  return Math.max(0, h);
}
