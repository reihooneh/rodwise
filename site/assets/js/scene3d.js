// The building in 3D: roofs coloured by the rolling sphere (coral where lightning can strike, blue
// where it can't), the sphere itself rolling over, lightning bolts landing where the
// electrogeometric model sends them, and air terminals. three.js is self-hosted.
//
// Model x runs east and y north; in three.js x is east, y is up and -z is north.
import * as THREE from '../vendor/three.module.min.js';

export function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const C = {
  wall: new THREE.Color('#b9b3c9'), roof: new THREE.Color('#8a8fa8'), exposed: new THREE.Color('#ff6b57'),
  protectedNear: new THREE.Color('#7ab8ff'), protectedFar: new THREE.Color('#3d5fae'), fitting: new THREE.Color('#ffb347'),
  tree: new THREE.Color('#3f8f5a'), trunk: new THREE.Color('#6b4a33'), rod: new THREE.Color('#ffd37a'),
};
export const KIND_COLOURS = ['#5d6480', '#ff6b57', '#ffb347', '#5fd38a', '#8fe3ff'];

export function createStage(container, { onFrame } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x090b16);
  container.prepend(renderer.domElement);
  renderer.domElement.setAttribute('aria-hidden', 'true');
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x090b16, 120, 420);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 1200);
  scene.add(new THREE.HemisphereLight(0xc9d4ff, 0x1a1c2e, 0.95));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(-40, 80, 50);
  scene.add(key);
  const flash = new THREE.PointLight(0xe9f0ff, 0, 160, 1.2);
  scene.add(flash);

  const ground = new THREE.Mesh(new THREE.CircleGeometry(400, 64), new THREE.MeshStandardMaterial({ color: 0x12162a, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const grid = new THREE.GridHelper(240, 48, 0x283058, 0x1a1f3a);
  grid.position.y = 0.02;
  scene.add(grid);

  const world = new THREE.Group();
  scene.add(world);
  const strikeLayer = new THREE.Group();
  scene.add(strikeLayer);
  let sphere = null, sphereWire = null;
  let building = null, grid2d = null, rodsGroup = null;
  let centre = { x: 0, z: 0 }, span = 30;

  // ---------- Building geometry ----------

  // A roof (or flat top) as a grid of vertices following the element's own height function, with
  // walls down to the ground around it.
  function roofHeight(e, x, y) {
    if (e.type === 'box') return e.h;
    if (e.type === 'gable') {
      const ns = e.ridgeRuns === 'north-south';
      const half = ns ? e.w / 2 : e.d / 2;
      const off = ns ? Math.abs(x - (e.x + e.w / 2)) : Math.abs(y - (e.y + e.d / 2));
      return e.eave + (e.ridge - e.eave) * Math.max(0, 1 - off / half);
    }
    const edge = Math.min(x - e.x, e.x + e.w - x, y - e.y, e.y + e.d - y);
    const pitch = (e.ridge - e.eave) / (Math.min(e.w, e.d) / 2);
    return Math.min(e.ridge, e.eave + pitch * edge);
  }

  function blockMesh(e, index) {
    const step = 0.5;
    const nx = Math.max(2, Math.round(e.w / step) & ~1), ny = Math.max(2, Math.round(e.d / step) & ~1);
    const pos = [], col = [], idx = [];
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const x = e.x + (e.w * i) / nx, y = e.y + (e.d * j) / ny;
        pos.push(x, roofHeight(e, x, y), -y);
        col.push(C.roof.r, C.roof.g, C.roof.b);
      }
    }
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
        // Split each quad along the diagonal that follows a hip line.
        const cx = e.x + (e.w * (i + 0.5)) / nx - (e.x + e.w / 2), cy = e.y + (e.d * (j + 0.5)) / ny - (e.y + e.d / 2);
        if (cx * cy > 0) idx.push(a, c, b, b, c, d);
        else idx.push(a, c, d, a, d, b);
      }
    }
    const roof = new THREE.BufferGeometry();
    roof.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    roof.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    roof.setIndex(idx);
    roof.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.05, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(roof, mat);
    mesh.userData = { element: index, kind: e.kind };
    // Walls: each side follows the roof edge.
    const wpos = [], widx = [];
    const sides = [
      [[e.x, e.y], [e.x + e.w, e.y]], [[e.x + e.w, e.y], [e.x + e.w, e.y + e.d]],
      [[e.x + e.w, e.y + e.d], [e.x, e.y + e.d]], [[e.x, e.y + e.d], [e.x, e.y]],
    ];
    for (const [[ax, ay], [bx, by]] of sides) {
      const n = 24;
      const base = wpos.length / 3;
      for (let k = 0; k <= n; k++) {
        const x = ax + ((bx - ax) * k) / n, y = ay + ((by - ay) * k) / n;
        wpos.push(x, 0, -y, x, roofHeight(e, Math.min(Math.max(x, e.x), e.x + e.w), Math.min(Math.max(y, e.y), e.y + e.d)), -y);
      }
      for (let k = 0; k < n; k++) {
        const a = base + 2 * k;
        widx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const walls = new THREE.BufferGeometry();
    walls.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
    walls.setIndex(widx);
    walls.computeVertexNormals();
    const wallMesh = new THREE.Mesh(walls, new THREE.MeshStandardMaterial({ color: e.kind === 'fitting' ? C.fitting : C.wall, roughness: 0.9, side: THREE.DoubleSide }));
    const g = new THREE.Group();
    g.add(wallMesh, mesh);
    g.userData = { roof: mesh, element: index };
    return g;
  }

  function roundMesh(e, index) {
    const g = new THREE.Group();
    if (e.type === 'tank') {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(e.r, e.r, e.h, 28), new THREE.MeshStandardMaterial({ color: 0x9aa3b8, roughness: 0.5, metalness: 0.4 }));
      m.position.set(e.x, e.h / 2, -e.y);
      g.add(m);
      g.userData = { tint: m, element: index };
    } else if (e.type === 'tree') {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(Math.max(0.15, e.r * 0.06), Math.max(0.25, e.r * 0.09), e.base + (e.top - e.base) * 0.3, 10), new THREE.MeshStandardMaterial({ color: C.trunk, roughness: 1 }));
      trunk.position.set(e.x, (e.base + (e.top - e.base) * 0.3) / 2, -e.y);
      const crown = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshStandardMaterial({ color: C.tree, roughness: 0.95, flatShading: true }));
      const hgt = e.top - e.base;
      crown.scale.set(e.r, hgt / 2, e.r);
      crown.position.set(e.x, e.base + hgt / 2, -e.y);
      g.add(trunk, crown);
      g.userData = { element: index };
    } else {
      // A pole: an antenna, flagpole or mast, with a small cross-bar so it reads as one.
      const mat = new THREE.MeshStandardMaterial({ color: 0xc5cbe0, roughness: 0.4, metalness: 0.7 });
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, e.h, 8), mat);
      m.position.set(e.x, e.h / 2, -e.y);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.06), mat);
      bar.position.set(e.x, e.h - 0.6, -e.y);
      g.add(m, bar);
      g.userData = { tint: m, element: index };
    }
    return g;
  }

  function setBuilding(b) {
    if (building) world.remove(building);
    building = new THREE.Group();
    b.elements.forEach((e, i) => {
      if (e.type === 'rod') return;
      building.add(e.type === 'box' || e.type === 'gable' || e.type === 'hip' ? blockMesh(e, i) : roundMesh(e, i));
    });
    world.add(building);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, top = 0;
    for (const e of b.elements) {
      const r = e.r || 0, w = e.w || 0, d = e.d || 0;
      const ax = e.w ? e.x : e.x - r, ay = e.d ? e.y : e.y - r;
      x0 = Math.min(x0, ax); y0 = Math.min(y0, ay);
      x1 = Math.max(x1, e.w ? e.x + w : e.x + r); y1 = Math.max(y1, e.d ? e.y + d : e.y + r);
      top = Math.max(top, e.h || e.ridge || e.top || 0);
    }
    centre = { x: (x0 + x1) / 2, z: -(y0 + y1) / 2 };
    span = Math.max(x1 - x0, y1 - y0, top * 1.4, 12);
    grid.position.x = centre.x;
    grid.position.z = centre.z;
    clearStrikes();
    frame(false);
    kick();
  }

  // ---------- Colouring by the sphere ----------

  // grid2d: {info, h, kind, under} from the model. A roof vertex takes the cell under it.
  function cellAt(x, y) {
    const { nx, ny, cell, x0, y0 } = grid2d.info;
    const i = Math.floor((x - x0) / cell), j = Math.floor((y - y0) / cell);
    if (i < 0 || j < 0 || i >= nx || j >= ny) return -1;
    return j * nx + i;
  }
  function colourFor(c, out) {
    const margin = grid2d.under[c] - grid2d.h[c];
    if (margin <= 0.005) return out.copy(C.exposed);
    const f = Math.min(1, margin / 3);
    return out.copy(C.protectedNear).lerp(C.protectedFar, f);
  }
  function setExposure(g) {
    grid2d = g;
    if (!building) return;
    const tmp = new THREE.Color();
    for (const part of building.children) {
      const roof = part.userData.roof;
      if (roof) {
        const pos = roof.geometry.attributes.position, col = roof.geometry.attributes.color;
        for (let v = 0; v < pos.count; v++) {
          const x = pos.getX(v), y = -pos.getZ(v);
          // Nudge inwards so an edge vertex reads its own cell, not the ground beside it.
          let best = -1;
          for (const [dx, dy] of [[0, 0], [0.2, 0.2], [-0.2, 0.2], [0.2, -0.2], [-0.2, -0.2]]) {
            const c = g ? cellAt(x + dx, y + dy) : -1;
            if (c >= 0 && g.owner[c] === part.userData.element) { best = c; break; }
            if (c >= 0 && best < 0 && g.h[c] > 0) best = c;
          }
          if (!g || best < 0) tmp.copy(C.roof);
          else colourFor(best, tmp);
          col.setXYZ(v, tmp.r, tmp.g, tmp.b);
        }
        col.needsUpdate = true;
      } else if (part.userData.tint && g) {
        // A pole or tank: coral if any of its cells is exposed.
        let exposed = false;
        for (let c = 0; c < g.h.length; c++) {
          if (g.owner[c] === part.userData.element && g.under[c] - g.h[c] <= 0.005) { exposed = true; break; }
        }
        part.userData.tint.material.color.copy(exposed ? C.exposed : C.protectedNear);
        part.userData.tint.material.emissive = new THREE.Color(exposed ? 0x401008 : 0x000000);
      }
    }
    kick();
  }

  // ---------- Air terminals ----------

  function setRods(rods, heightAt) {
    if (rodsGroup) world.remove(rodsGroup);
    rodsGroup = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: C.rod, roughness: 0.3, metalness: 0.9, emissive: 0x302000 });
    for (const r of rods || []) {
      const base = heightAt ? heightAt(r.x, r.y) : 0;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, r.length, 8), mat);
      m.position.set(r.x, base + r.length / 2, -r.y);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), new THREE.MeshBasicMaterial({ color: 0xfff1b8 }));
      tip.position.set(r.x, base + r.length, -r.y);
      rodsGroup.add(m, tip);
    }
    world.add(rodsGroup);
    kick();
  }

  // ---------- The rolling sphere ----------

  let sphereRadius = 0, roll = 0, rollPath = null;
  function setSphere(radius, g) {
    if (sphere) { scene.remove(sphere); scene.remove(sphereWire); sphere = sphereWire = null; }
    sphereRadius = radius;
    rollPath = null;
    if (!radius || !g) { kick(); return; }
    const geo = new THREE.SphereGeometry(radius, 48, 32);
    sphere = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x8fd3ff, transparent: true, opacity: 0.07, depthWrite: false }));
    sphereWire = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.SphereGeometry(radius, 24, 14)), new THREE.LineBasicMaterial({ color: 0x8fd3ff, transparent: true, opacity: 0.22 }));
    scene.add(sphere, sphereWire);
    // The path: west to east across the middle of the building, at the lowest the sphere can sit.
    const { nx, ny, cell, x0, y0 } = g.info;
    const yMid = (g.info.miny + g.info.maxy) / 2;
    const j = Math.min(ny - 1, Math.max(0, Math.floor((yMid - y0) / cell)));
    rollPath = { xs: [], zs: [], y: yMid };
    for (let i = 0; i < nx; i++) {
      rollPath.xs.push(x0 + (i + 0.5) * cell);
      rollPath.zs.push(g.centre[j * nx + i]);
    }
    roll = 0;
    placeSphere();
    frame(true);
  }
  function placeSphere() {
    if (!sphere || !rollPath) return;
    const n = rollPath.xs.length;
    const t = (Math.sin(roll) + 1) / 2; // back and forth
    const f = t * (n - 1), i = Math.min(n - 2, Math.floor(f)), u = f - i;
    const x = rollPath.xs[i] + (rollPath.xs[i + 1] - rollPath.xs[i]) * u;
    const z = rollPath.zs[i] + (rollPath.zs[i + 1] - rollPath.zs[i]) * u;
    sphere.position.set(x, z, -rollPath.y);
    sphereWire.position.copy(sphere.position);
    sphereWire.rotation.z = -x / sphereRadius; // it rolls
    onFrame?.({ sphereX: x });
  }

  // ---------- Strikes ----------

  let queue = [], dots = null, dotCount = 0, bolts = [];
  const MAX_DOTS = 600;
  function clearStrikes() {
    for (const b of bolts) strikeLayer.remove(b.line);
    bolts = [];
    if (dots) strikeLayer.remove(dots);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(MAX_DOTS * 3), 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(MAX_DOTS * 3), 3));
    geo.setDrawRange(0, 0);
    dots = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.55, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false }));
    strikeLayer.add(dots);
    dotCount = 0;
    queue = [];
  }
  function setStrikes(list) {
    clearStrikes();
    queue = list.slice();
    if (reduced() || !playing) while (queue.length) addDot(queue.shift());
    kick();
  }
  function addDot(s) {
    if (dotCount >= MAX_DOTS) return;
    const p = dots.geometry.attributes.position, c = dots.geometry.attributes.color;
    p.setXYZ(dotCount, s.x, s.z + 0.15, -s.y);
    const col = new THREE.Color(KIND_COLOURS[s.kind] || KIND_COLOURS[0]);
    c.setXYZ(dotCount, col.r, col.g, col.b);
    dotCount++;
    dots.geometry.setDrawRange(0, dotCount);
    p.needsUpdate = c.needsUpdate = true;
  }
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  function bolt(s) {
    const pts = [];
    let x = s.x + (rnd() - 0.5) * 8, y = s.y + (rnd() - 0.5) * 8, z = Math.max(60, s.z + 50);
    const n = 14;
    for (let k = 0; k <= n; k++) {
      const f = k / n;
      const jx = k === n ? 0 : (rnd() - 0.5) * 3 * (1 - f), jy = k === n ? 0 : (rnd() - 0.5) * 3 * (1 - f);
      pts.push(new THREE.Vector3(x + (s.x - x) * f + jx, z + (s.z - z) * f, -(y + (s.y - y) * f + jy)));
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xf3f6ff, transparent: true, opacity: 1 }));
    strikeLayer.add(line);
    bolts.push({ line, age: 0 });
    flash.position.set(s.x, s.z + 6, -s.y);
    flash.intensity = 220;
    addDot(s);
  }

  // ---------- Camera ----------

  let theta = -0.6, phi = 0.5, dist = 60, dragging = null, wide = false;
  function frame(useSphere) {
    wide = useSphere && sphereRadius > 0;
    const r = wide ? Math.max(span, sphereRadius * 2.2) : span;
    dist = r * 1.55 + 8;
    place();
  }
  function place() {
    const lookY = wide ? sphereRadius * 0.45 : span * 0.18;
    camera.position.set(centre.x + Math.sin(theta) * Math.cos(phi) * dist, lookY + Math.sin(phi) * dist, centre.z + Math.cos(theta) * Math.cos(phi) * dist);
    camera.lookAt(centre.x, lookY, centre.z);
  }
  const elc = renderer.domElement;
  elc.addEventListener('pointerdown', (e) => { dragging = { x: e.clientX, y: e.clientY, theta, phi, id: e.pointerId }; elc.setPointerCapture?.(e.pointerId); });
  elc.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== dragging.id) return;
    theta = dragging.theta - (e.clientX - dragging.x) * 0.006;
    phi = Math.max(0.12, Math.min(1.35, dragging.phi + (e.clientY - dragging.y) * 0.004));
    place();
    kick();
  });
  const end = () => { dragging = null; };
  elc.addEventListener('pointerup', end);
  elc.addEventListener('pointercancel', end);

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    kick();
  }
  new ResizeObserver(resize).observe(container);
  let visible = true;
  new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting;
    if (visible) kick();
  }).observe(container);

  // ---------- Animation ----------

  let playing = !reduced(), raf = 0, last = 0, nextBolt = 0;
  function tick(now) {
    raf = 0;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    if (playing) {
      if (sphere) { roll += dt * 0.35; placeSphere(); }
      nextBolt -= dt;
      if (queue.length && nextBolt <= 0) { bolt(queue.shift()); nextBolt = 0.18 + rnd() * 0.3; }
      for (const b of bolts) b.age += dt;
      for (const b of bolts.filter((q) => q.age > 0.35)) strikeLayer.remove(b.line);
      bolts = bolts.filter((q) => q.age <= 0.35);
      for (const b of bolts) b.line.material.opacity = 1 - b.age / 0.35;
      flash.intensity *= Math.pow(0.002, dt);
      if (!dragging) { theta += dt * 0.04; place(); }
    }
    renderer.render(scene, camera);
    if (visible && (playing || bolts.length)) raf = requestAnimationFrame(tick);
    else last = 0;
  }
  function kick() {
    if (!raf) raf = requestAnimationFrame(tick);
  }

  resize();
  return {
    setBuilding, setExposure, setRods, setSphere, setStrikes, frame: (s) => { frame(s); kick(); },
    play(on) {
      playing = on && !reduced();
      if (!playing) while (queue.length) addDot(queue.shift());
      kick();
      return playing;
    },
    get playing() { return playing; },
  };
}
