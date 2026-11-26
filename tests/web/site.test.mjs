// Browser tests for every page at phone, tablet and desktop widths: no errors, no sideways
// scrolling, no text on top of other text (HTML or SVG), and the main things work.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { serve } from '../../scripts/serve.mjs';

const PAGES = ['index.html', 'check.html', 'protect.html', 'method.html'];
const SIZES = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'phone', width: 390, height: 844 },
];
let server, browser, base;

before(async () => {
  server = await serve(0);
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
});
after(async () => {
  await browser?.close();
  server?.close();
});

async function open(path, size = SIZES[0]) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, reducedMotion: 'reduce', acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/GL Driver Message|WebGL/.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + path);
  await page.waitForFunction(() => document.body.dataset.ready, null, { timeout: 180000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  return { page, context, errors };
}

// Every piece of visible text, HTML or SVG: no two different pieces overlap.
async function textOverlaps(page) {
  return page.evaluate(() => {
    const boxes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (!n.textContent.trim()) continue;
      const elx = n.parentElement;
      if (elx.closest('.sr, [hidden], .skip, option, title, select')) continue;
      const det = elx.closest('details');
      if (det && !det.open && !elx.closest('summary')) continue;
      const cs = getComputedStyle(elx);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
      if (elx instanceof SVGElement) {
        const r = elx.getBoundingClientRect();
        if (r.width >= 1 && r.height >= 1) boxes.push({ r, text: n.textContent.trim().slice(0, 40), node: n });
        continue;
      }
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) if (r.width >= 1 && r.height >= 1) boxes.push({ r, text: n.textContent.trim().slice(0, 40), node: n });
    }
    const out = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (a.node === b.node) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w > 2 && h > Math.min(a.r.height, b.r.height) * 0.35) out.push(`"${a.text}" overlaps "${b.text}"`);
      }
    }
    return out;
  });
}

// Everything drawn in a chart stays inside the chart.
async function svgOutside(page) {
  return page.evaluate(() => {
    const out = [];
    for (const s of document.querySelectorAll('svg.chart')) {
      const f = s.getBoundingClientRect();
      for (const t of s.querySelectorAll('text, line, rect, path')) {
        const r = t.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.left < f.left - 1 || r.right > f.right + 1 || r.top < f.top - 1 || r.bottom > f.bottom + 1) out.push(t.textContent || t.tagName);
      }
    }
    return out;
  });
}

// Controls must not sit on top of each other.
async function boxOverlaps(page) {
  return page.evaluate(() => {
    const els = [...document.querySelectorAll('main .button, main button, main input:not([type=file]), main select, main .stage, main table, main .tile, main .chart-box, main .legend, main .pill, main .rodlist li, main .drop, main .fact, main .planbox')]
      .filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[hidden]'));
    const out = [];
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        if (els[i].contains(els[j]) || els[j].contains(els[i])) continue;
        const a = els[i].getBoundingClientRect(), b = els[j].getBoundingClientRect();
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 1 && h > 1) out.push(`${els[i].id || els[i].className || els[i].tagName} overlaps ${els[j].id || els[j].className || els[j].tagName}`);
      }
    }
    return out;
  });
}

for (const path of PAGES) {
  for (const size of SIZES) {
    test(`${path} at ${size.name}: no errors, no sideways scroll, nothing overlapping`, async () => {
      const { page, context, errors } = await open(path, size);
      const scroll = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(scroll <= 0, `page scrolls sideways by ${scroll}px`);
      assert.deepEqual(await textOverlaps(page), []);
      assert.deepEqual(await svgOutside(page), []);
      assert.deepEqual(await boxOverlaps(page), []);
      assert.deepEqual(errors, []);
      await context.close();
    });
  }
}

test('every page has the strict content security policy and loads nothing from elsewhere', async () => {
  for (const path of PAGES) {
    const html = readFileSync(new URL(`../../site/${path}`, import.meta.url), 'utf8');
    assert.match(html, /default-src 'none'; script-src 'self' 'wasm-unsafe-eval'/);
    assert.doesNotMatch(html, /<script(?![^>]*src="assets\/js\/)/, 'inline script');
    assert.doesNotMatch(html, /style="/, 'inline style');
    assert.doesNotMatch(html, /src="https?:/);
  }
});

const runs = (page, n) => page.waitForFunction((k) => Number(document.body.dataset.runs || 0) >= k, n, { timeout: 180000 });

test('check: the model runs in the browser, responds to the level, and loads nothing from elsewhere', async () => {
  const { page, context, errors } = await open('check.html');
  const outside = [];
  page.on('request', (r) => { if (!r.url().startsWith(base)) outside.push(r.url()); });
  await runs(page, 1);
  assert.match(await page.textContent('#headline'), /level III \(a 45 m sphere\)/);
  const at45 = await page.textContent('#t-exposed');
  await page.click('#levels button[data-level="I"]');
  await runs(page, 2);
  assert.match(await page.textContent('#headline'), /level I \(a 20 m sphere\)/);
  const at20 = await page.textContent('#t-exposed');
  assert.ok(parseInt(at20, 10) > parseInt(at45, 10), `a smaller sphere reaches more roof: ${at20} vs ${at45}`);
  assert.equal(await page.locator('#parts tr').count(), 7);
  await page.selectOption('#example', 'flats');
  await runs(page, 3);
  assert.equal(await page.isVisible('#tall'), true, 'an eight-storey block at level I can take side flashes');
  assert.deepEqual(outside, []);
  assert.deepEqual(errors, []);
  await context.close();
});

test('check: a building file is checked before anything uses it', async () => {
  const { page, context, errors } = await open('check.html');
  await runs(page, 1);
  const load = (name, body) => page.setInputFiles('#file', { name, mimeType: 'application/json', buffer: Buffer.from(body) });
  await load('bad.json', '{not json');
  await page.waitForFunction(() => document.getElementById('error').textContent.length > 0);
  assert.match(await page.textContent('#error'), /not valid JSON/);
  await load('xss.json', JSON.stringify({ name: '<img src=x onerror=alert(1)>', elements: [{ type: 'box', x: 0, y: 0, w: 5, d: 5, h: 3 }] }));
  await page.waitForFunction(() => /short name/.test(document.getElementById('error').textContent));
  await load('nan.json', '{"elements":[{"type":"box","x":0,"y":0,"w":5,"d":5,"h":1e999}]}');
  await page.waitForFunction(() => /h must be a number/.test(document.getElementById('error').textContent));
  await load('huge.json', JSON.stringify({ elements: [{ type: 'box', x: 0, y: 0, w: 5, d: 5, h: 3 }], pad: 'x'.repeat(70000) }));
  await page.waitForFunction(() => /64 KB/.test(document.getElementById('error').textContent));
  assert.equal(await page.locator('img').count(), 0);
  await load('shed.json', JSON.stringify({ name: 'Garden shed', elements: [{ type: 'gable', x: 0, y: 0, w: 4, d: 3, eave: 2.2, ridge: 3 }, { type: 'pole', kind: 'fitting', name: 'Weather vane', x: 2, y: 1.5, h: 4.5 }] }));
  await runs(page, 2);
  assert.match(await page.textContent('#example'), /My building: Garden shed/);
  assert.equal(await page.textContent('#error'), '');
  assert.equal(await page.locator('#parts tr').count(), 2);
  assert.deepEqual(errors, []);
  await context.close();
});

test('protect: the plan leaves nothing exposed, and the strikes go to the rods', async () => {
  const { page, context, errors } = await open('protect.html');
  await runs(page, 1);
  assert.match(await page.textContent('#headline'), /air terminals? for \$[\d,]+ leaves? nothing on the roof for a 45 m sphere/);
  assert.equal(await page.textContent('#f-after'), '0%');
  const before = parseFloat(await page.textContent('#f-sbefore')), afterText = await page.textContent('#f-safter');
  assert.ok(afterText === '<0.01' || parseFloat(afterText) < before / 10, `strikes to the roof: ${before} -> ${afterText}`);
  assert.ok(await page.locator('#rods li').count() >= 1);
  await page.fill('#l1', '0.3');
  await page.click('#run');
  await page.waitForFunction(() => /longer than the one before/.test(document.getElementById('error').textContent));
  assert.deepEqual(errors, []);
  await context.close();
});

test('method: the charts are drawn from the model', async () => {
  const { page, context, errors } = await open('method.html');
  assert.equal(await page.locator('#c-area circle').count(), 16);
  assert.ok((await page.locator('#c-current path').count()) >= 1);
  await page.fill('#p-rod', '2');
  assert.match(await page.textContent('#p-caption'), /With a 2.0 m rod/);
  assert.deepEqual(errors, []);
  await context.close();
});
