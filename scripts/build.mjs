// Builds the site from its sources (run after `make wasm`, which `npm run build` does first):
//   src/pages/*.html + the shared layout  ->  site/*.html (strict CSP, no inline code)
//   examples/*.json                       ->  site/assets/examples/
//   three.js and the fonts (pinned npm)   ->  site/assets/vendor, site/assets/fonts
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const at = (p) => join(root, p);

const copies = [
  ['node_modules/three/build/three.module.min.js', 'site/assets/vendor/three.module.min.js'],
  ['node_modules/three/LICENSE', 'site/assets/vendor/three.LICENSE.txt'],
  ['node_modules/@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2', 'site/assets/fonts/space-grotesk-latin.woff2'],
  ['node_modules/@fontsource-variable/space-grotesk/LICENSE', 'site/assets/fonts/space-grotesk.LICENSE.txt'],
  ['node_modules/@fontsource-variable/newsreader/files/newsreader-latin-wght-normal.woff2', 'site/assets/fonts/newsreader-latin.woff2'],
  ['node_modules/@fontsource-variable/newsreader/files/newsreader-latin-wght-italic.woff2', 'site/assets/fonts/newsreader-latin-italic.woff2'],
  ['node_modules/@fontsource-variable/newsreader/LICENSE', 'site/assets/fonts/newsreader.LICENSE.txt'],
];
for (const [from, to] of copies) {
  mkdirSync(dirname(at(to)), { recursive: true });
  copyFileSync(at(from), at(to));
}
rmSync(at('site/assets/examples'), { recursive: true, force: true });
mkdirSync(at('site/assets/examples'), { recursive: true });
for (const f of readdirSync(at('examples')).filter((f) => f.endsWith('.json')).sort()) {
  // Re-serialise, so only valid JSON is ever published.
  writeFileSync(at(`site/assets/examples/${f}`), `${JSON.stringify(JSON.parse(readFileSync(at(`examples/${f}`), 'utf8')), null, 1)}\n`);
}

const CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');
const NAV = [
  ['index', 'index.html', 'Home'],
  ['check', 'check.html', 'Where it strikes'],
  ['protect', 'protect.html', 'Protect it'],
  ['method', 'method.html', 'How it works'],
];
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pagesDir = at('src/pages');
for (const file of readdirSync(pagesDir).filter((f) => f.endsWith('.html')).sort()) {
  const raw = readFileSync(join(pagesDir, file), 'utf8');
  const m = raw.match(/^<!--(\{[\s\S]*?\})-->\n/);
  if (!m) throw new Error(`${file}: missing the JSON header comment`);
  const meta = JSON.parse(m[1]);
  const body = raw.slice(m[0].length);
  if (/<script(?![^>]*\bsrc=)/i.test(body) || /\son\w+=/i.test(body) || /style=/i.test(body)) throw new Error(`${file}: inline code or styles`);
  const nav = NAV.map(([id, href, label]) => `<a href="${href}"${id === meta.nav ? ' aria-current="page"' : ''}>${label}</a>`).join('\n        ');
  const html = `<!doctype html>
<html lang="en-AU">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${CSP}">
  <meta name="referrer" content="no-referrer">
  <meta name="color-scheme" content="dark">
  <title>${esc(meta.title)}</title>
  <meta name="description" content="${esc(meta.description)}">
  <link rel="icon" href="assets/icon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="assets/css/site.css">
  <script type="module" src="assets/js/${meta.script}"></script>
</head>
<body class="page-${meta.nav}">
  <a class="skip" href="#main">Skip to the content</a>
  <header class="top">
    <div class="top-inner">
      <a class="mark" href="index.html" aria-label="Rodwise home">
        <svg class="mark-icon" viewBox="0 0 32 32" aria-hidden="true"><path d="M4 28h24" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><path d="M16 27V9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><circle class="line" cx="16" cy="7" r="2.6"/><path class="line" d="M24 3l-4 7h3l-3 7 7-9h-3l2-5z"/></svg>
        <span>Rodwise</span>
      </a>
      <nav class="nav" aria-label="Pages">
        ${nav}
      </nav>
    </div>
  </header>
  <main id="main">
${body.trimEnd()}
  </main>
  <footer class="foot">
    <div class="foot-inner">
      <p>Rodwise runs in your browser: a building you load never leaves this device. It applies the rolling sphere method of AS/NZS 1768 and IEC 62305-3 to a simplified model of the building, to help you understand and discuss protection. It is not a design: a lightning protection system must be designed, installed and inspected by a qualified professional to the standard.</p>
      <p>Built by Reihaneh Rahmati · <a href="https://github.com/reihooneh/rodwise">Source on GitHub</a></p>
    </div>
  </footer>
</body>
</html>
`;
  writeFileSync(at(`site/${file}`), html);
}
console.log('built the site');
