#!/usr/bin/env node
/**
 * Artwork-hash benchmark on the binder-page fixtures: for every pocket of every photo in
 * scripts/fixtures/binder-pages/, how close the pocket's hash (src/scanner/hash.ts) comes to the
 * expected card's entry in public/data/hashes.json, and whether that entry is the nearest.
 *
 *   node scripts/hash-bench.mjs                   # the three fixtures
 *   node scripts/hash-bench.mjs --json            # raw records
 *   node scripts/hash-bench.mjs --no-refs         # skip the reference-image checks (needs the network)
 *   node scripts/hash-bench.mjs --chrome <exe>    # or CHROME_PATH
 *
 * Runs scripts/hash-bench.html in a headless Chrome through this repo's Vite dev server, like
 * scripts/grid-bench.mjs. Per pocket the card is placed five ways (cell · fit · refine · coarse ·
 * fine, see the HTML; `fine` is what the scanner does); the table at the end counts, per placement, pockets whose nearest hash is the
 * expected card (`exact`), the expected artwork in another printing (`name`), and the median
 * margin to the next different artwork. Expected cards: scripts/fixtures/binder-pages/README.md.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(root, 'scripts', 'fixtures', 'binder-pages');

/** Row-major catalog ids per fixture photo (mirrors the fixtures README). */
const EXPECTED = {
  'fold8-9pocket.jpg': ['swsh10.5-016', 'sv03.5-200', 'swsh10.5-017', 'sv03.5-010', 'xy12-3', 'xy12-4', 'sv09-003', 'sv03.5-013', 'xy1-3'],
  'pixel11-9pocket.jpg': ['swsh10.5-016', 'sv03.5-200', 'swsh10.5-017', 'sv03.5-010', 'xy12-3', 'xy12-4', 'sv09-003', 'sv03.5-013', 'xy1-3'],
  'pixel11-9pocket-b.jpg': ['dp2-56', 'dp2-31', 'sv03.5-031', 'xy12-43', 'dp3-97', 'base1-55', 'xy12-44', 'base4-11', 'xy3-70'],
};

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  if (i === -1) return def;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const flag = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
};
const chromeOpt = opt('--chrome', process.env.CHROME_PATH);
const layout = opt('--layout', '3x3');
const jsonOnly = flag('--json');
const noRefs = flag('--no-refs');
if (flag('--help') || flag('-h')) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*\n|^ \* ?/gm, ''));
  process.exit(0);
}
let photos = args.map((p) => path.resolve(root, p));
if (!photos.length) photos = Object.keys(EXPECTED).map((f) => path.join(FIXTURES, f));
for (const p of photos) if (!fs.existsSync(p)) {
  console.error(`not found: ${p}`);
  process.exit(2);
}
if (!fs.existsSync(path.join(root, 'public', 'data', 'hashes.json'))) {
  console.error('public/data/hashes.json missing: run `npm run hashes` first');
  process.exit(2);
}

function findChrome() {
  const candidates = [
    chromeOpt,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const hit = candidates.find((c) => fs.existsSync(c));
  if (!hit) {
    console.error('No Chrome/Edge found; pass --chrome <path> or set CHROME_PATH.');
    process.exit(2);
  }
  return hit;
}

function servedPath(abs) {
  const rel = path.relative(root, abs);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return '/' + rel.split(path.sep).join('/');
  return '/@fs/' + abs.split(path.sep).join('/').replace(/^\//, '');
}

let resolveReport;
const report = new Promise((r) => (resolveReport = r));
const reportPlugin = {
  name: 'hash-bench-report',
  configureServer(server) {
    server.middlewares.use('/__hash-bench', (req, res) => {
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.end();
        return;
      }
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        res.end('ok');
        resolveReport(JSON.parse(body));
      });
    });
  },
};

const allow = [root, ...new Set(photos.map((p) => path.dirname(p)))];
const server = await createServer({
  configFile: path.join(root, 'vite.config.ts'),
  root,
  logLevel: 'error',
  plugins: [reportPlugin],
  server: { host: '127.0.0.1', port: 0, strictPort: false, open: false, fs: { allow } },
});
await server.listen();
const base = server.resolvedUrls.local[0];
const query = new URLSearchParams({
  imgs: photos.map(servedPath).join(','),
  expected: JSON.stringify(EXPECTED),
  layout,
  refs: noRefs ? '0' : '1',
  report: '/__hash-bench',
});
const url = `${base}scripts/hash-bench.html?${query}`;

const chrome = findChrome();
const profile = path.join(root, 'scripts', '.cache', 'chrome-profile');
fs.mkdirSync(profile, { recursive: true });
if (!jsonOnly) console.log(`vite ${base} · ${path.basename(chrome)} headless · ${photos.length} photo(s), layout ${layout}`);
const proc = spawn(
  chrome,
  ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio', `--user-data-dir=${profile}`, '--window-size=1280,900', url],
  { stdio: 'ignore' },
);
const timeoutMs = 300_000;
const timer = setTimeout(() => {
  console.error(`no result after ${timeoutMs / 1000} s; open ${url} in a browser to see what happens`);
  proc.kill();
  server.close().finally(() => process.exit(3));
}, timeoutMs);
const results = await report;
clearTimeout(timer);
proc.kill();
await server.close();

if (jsonOnly) {
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
}

const VARIANTS = ['cell', 'fit', 'refine', 'coarse', 'fine'];
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : NaN;
};
console.log(`table: ${results.table.ids} hashes (${results.table.spec}, built ${results.table.builtAt}); ${results.bits} bits, pockets resampled to ${results.sampleWidth} px wide\n`);
const totals = Object.fromEntries(VARIANTS.map((v) => [v, { n: 0, exact: 0, name: 0, inTable: 0, margins: [], marginsNext: [], dExp: [], ms: [] }]));
for (const img of results.images) {
  const name = path.basename(img.image);
  if (img.error) {
    console.log(`${name}: ERROR ${img.error}\n`);
    continue;
  }
  console.log(`${name}  ${img.width}×${img.height}  grid conf ${img.fit.confidence}  card/cell ${img.cardFrac.x}×${img.cardFrac.y}`);
  console.log(`  #  expected       fine: nearest (d)          d(exp) rank  margin next   ms | cell d/rank  fit d/rank  refine d/rank  coarse d/rank`);
  const perImage = Object.fromEntries(VARIANTS.map((v) => [v, { exact: 0, name: 0 }]));
  for (const p of img.pockets) {
    const s = p.variants.fine;
    const e = s.expected;
    const mark = s.exact ? '✓' : s.sameName ? '≈' : '✗';
    const top = s.top[0] ? `${s.top[0].id} (${s.top[0].d})`.padEnd(24) : '-'.padEnd(24);
    const dExp = e?.inTable ? `${String(e.d).padStart(3)} ${String(e.rank).padStart(5)}` : '  not in table';
    const other = VARIANTS.filter((v) => v !== 'fine')
      .map((v) => {
        const r = p.variants[v];
        if (!r) return '   -/-   ';
        const ex = r.expected;
        return `${(ex?.inTable ? `${ex.d}/${ex.rank}` : '-').padStart(7)}${r.exact ? '✓' : r.sameName ? '≈' : ' '} `;
      })
      .join('  ');
    console.log(`  ${p.index}  ${(p.expected ?? '-').padEnd(13)} ${mark} ${top} ${dExp}  ${String(s.margin ?? '-').padStart(5)} ${String(s.marginNext ?? '-').padStart(4)} ${String(p.matchMs).padStart(4)} | ${other}`);
    for (const v of VARIANTS) {
      const r = p.variants[v];
      if (!r || !p.expected) continue;
      const t = totals[v];
      t.n++;
      if (r.exact) t.exact++;
      if (r.sameName) t.name++;
      if (r.expected?.inTable) {
        t.inTable++;
        t.dExp.push(r.expected.d);
      }
      if (r.margin !== null && r.margin !== undefined) t.margins.push(r.margin);
      if (r.marginNext !== null && r.marginNext !== undefined) t.marginsNext.push(r.marginNext);
      if (v === 'fine') t.ms.push(p.matchMs);
      if (r.exact) perImage[v].exact++;
      if (r.sameName) perImage[v].name++;
    }
  }
  console.log(`  hits (exact / same artwork) of ${img.pockets.length}: ` + VARIANTS.map((v) => `${v} ${perImage[v].exact}/${perImage[v].name}`).join('  ') + '\n');
}
console.log('placement   pockets  exact  same-artwork  median d(expected)  median margin (other artwork / next card)');
for (const v of VARIANTS) {
  const t = totals[v];
  console.log(`${v.padEnd(11)} ${String(t.n).padStart(7)}  ${String(t.exact).padStart(5)}  ${String(t.name).padStart(12)}  ${String(median(t.dExp)).padStart(18)}  ${String(median(t.margins)).padStart(13)} / ${median(t.marginsNext)}${v === 'fine' ? `   (${median(t.ms)} ms per pocket, sample→match)` : ''}`);
}
if (results.refs) {
  console.log('\nreference images hashed in the browser (distance to the Node-built entry; shift/scale tolerance as d → rank among all cards)');
  for (const r of results.refs) {
    if (r.error) {
      console.log(`  ${r.id}: ERROR ${r.error}`);
      continue;
    }
    const sh = Object.entries(r.shift).map(([s, v]) => `${Math.round(s * 100)}%:${v.d}→${v.rank}`).join(' ');
    const sc = Object.entries(r.scale).map(([s, v]) => `×${s}:${v.d}→${v.rank}`).join(' ');
    console.log(`  ${r.id.padEnd(13)} native d=${r.native.d}  resampled d=${r.resampled.d}  shift ${sh}  scale ${sc}`);
  }
}
console.log('\nJSON: node scripts/hash-bench.mjs --json; expected cards: scripts/fixtures/binder-pages/README.md');
process.exit(results.images.some((r) => r.error) ? 1 : 0);
