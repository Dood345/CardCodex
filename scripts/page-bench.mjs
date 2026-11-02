#!/usr/bin/env node
/**
 * End-to-end binder-page benchmark: scanPage (OCR with Tesseract + artwork hashes + the game's
 * matcher) on binder pages, the way the app runs it (headless Chrome through this repo's Vite dev
 * server, like grid-bench and hash-bench). Pokémon runs on the fixture photos in
 * scripts/fixtures/binder-pages/; Yu-Gi-Oh! (no real photos yet) on the synthetic page
 * scripts/synth-page.mjs composes from the cached YGOPRODeck renders. Per pocket: the candidate,
 * whether it is the expected card, whether it was called confident; per photo: exact, confident,
 * confident-and-wrong, expected among the alternatives, page time and the share spent on hashing.
 *
 *   node scripts/page-bench.mjs                   # OCR + artwork (the shipped pipeline)
 *   node scripts/page-bench.mjs --game ygo        # Yu-Gi-Oh! on the synthetic page (expected = passcodes: any printing counts)
 *   node scripts/page-bench.mjs --no-hash         # OCR only (the baseline)
 *   node scripts/page-bench.mjs --no-strip        # without the magnified number-strip re-read
 *   node scripts/page-bench.mjs --json            # raw records
 *   node scripts/page-bench.mjs --chrome <exe>    # or CHROME_PATH
 *
 * Tesseract runs in the page (WASM, ~2–4 s per pocket in headless Chrome), so a run takes a few
 * minutes. Baselines: src/scanner/README.md, "Artwork matching".
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { synthPage } from './synth-page.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(root, 'scripts', 'fixtures', 'binder-pages');
const CACHE = path.resolve(process.env.CARDCODEX_CACHE_DIR || path.join(root, 'scripts', '.cache'));

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
const game = opt('--game', 'pokemon');
const layout = opt('--layout', '3x3');
const jsonOnly = flag('--json');
const noHash = flag('--no-hash');
const noStrip = flag('--no-strip');
if (flag('--help') || flag('-h')) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*\n|^ \* ?/gm, ''));
  process.exit(0);
}
if (game !== 'pokemon' && game !== 'ygo') {
  console.error(`unknown game ${game}: --game pokemon | ygo`);
  process.exit(2);
}
const hashesFile = path.join(root, 'public', 'data', game === 'ygo' ? path.join('ygo', 'hashes.json') : 'hashes.json');
if (!noHash && !fs.existsSync(hashesFile)) {
  console.error(`${path.relative(root, hashesFile)} missing: run \`npm run hashes${game === 'ygo' ? ':ygo' : ''}\` first (or pass --no-hash)`);
  process.exit(2);
}
let photos = args.map((p) => path.resolve(root, p));
if (!photos.length) {
  if (game === 'ygo') {
    // The synthetic page from the cached renders (scripts/synth-page.mjs), made on first use.
    const page = path.join(CACHE, 'synth-pages', `ygo-${layout}.jpg`);
    if (!fs.existsSync(page)) {
      const [cols, rows] = layout.split('x').map(Number);
      const { buffer, meta } = await synthPage({ game, cols, rows, cacheDir: CACHE });
      fs.mkdirSync(path.dirname(page), { recursive: true });
      fs.writeFileSync(page, buffer);
      fs.writeFileSync(page.replace(/\.jpg$/, '.json'), JSON.stringify(meta, null, 2) + '\n');
      if (!jsonOnly) console.log(`made ${path.relative(root, page)} (${meta.width}×${meta.height})`);
    }
    photos = [page];
  } else {
    photos = Object.keys(EXPECTED).map((f) => path.join(FIXTURES, f));
  }
}
for (const p of photos) if (!fs.existsSync(p)) {
  console.error(`not found: ${p}`);
  process.exit(2);
}
// Expected ids per photo: the fixtures' list, or a `<photo>.json` sidecar with `ids` (row-major), as synth-page.mjs writes.
for (const p of photos) {
  const name = path.basename(p);
  if (EXPECTED[name]) continue;
  const sidecar = p.replace(/\.[^.]+$/, '') + '.json';
  if (fs.existsSync(sidecar)) {
    const meta = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
    if (Array.isArray(meta.ids)) EXPECTED[name] = meta.ids.map(String);
  }
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
  name: 'page-bench-report',
  configureServer(server) {
    server.middlewares.use('/__page-bench', (req, res) => {
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
  game,
  layout,
  hash: noHash ? '0' : '1',
  strip: noStrip ? '0' : '1',
  report: '/__page-bench',
});
const url = `${base}scripts/page-bench.html?${query}`;

const chrome = findChrome();
// Own profile per mode and game so an OCR-only and a hash run can go in parallel.
const profile = path.join(root, 'scripts', '.cache', `chrome-profile-page${noHash ? '-ocr' : ''}${game === 'ygo' ? '-ygo' : ''}`);
fs.mkdirSync(profile, { recursive: true });
if (!jsonOnly) console.log(`vite ${base} · ${path.basename(chrome)} headless · ${game} · ${photos.length} photo(s), layout ${layout}, hash ${noHash ? 'off' : 'on'}, strip ${noStrip ? 'off' : 'on'}`);
const proc = spawn(
  chrome,
  ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio', `--user-data-dir=${profile}`, '--window-size=1280,900', url],
  { stdio: 'ignore' },
);
const timeoutMs = 20 * 60_000;
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

const kb = (b) => (b === null || b === undefined ? '?' : `${Math.round(b / 1024)} KB`);
console.log(`${results.game} matcher built in ${results.matcherMs} ms` + (results.table ? `; hash table: ${results.table.ids} ids (${results.table.spec}), loaded in ${results.table.loadMs} ms, words ${kb(results.table.wordsBytes)}, heap +${kb(results.table.heapDeltaBytes)}` : '') + '\n');
const totals = { n: 0, exact: 0, confident: 0, confidentRight: 0, confidentWrong: 0, inAlts: 0, pageMs: 0, hashMs: 0 };
for (const img of results.images) {
  const name = path.basename(img.image);
  if (img.error) {
    console.log(`${name}: ERROR ${img.error}\n`);
    continue;
  }
  console.log(`${name}  ${img.width}×${img.height}  grid conf ${img.fit.confidence}  page ${(img.pageMs / 1000).toFixed(1)} s (hash ${(img.hashMs / 1000).toFixed(2)} s)`);
  console.log(`  #  expected       got                 ok  conf  score margin  lines    ms  evidence`);
  const t = { exact: 0, confident: 0, confidentRight: 0, confidentWrong: 0, inAlts: 0 };
  for (const p of img.pockets) {
    const mark = p.exact ? '✓' : p.inAlternatives ? '≈' : p.got ? '✗' : '-';
    const conf = p.confident ? (p.exact ? 'YES' : 'yes!') : '   ';
    console.log(
      `  ${p.index}  ${(p.expected ?? '-').padEnd(13)}  ${(p.got ?? '-').padEnd(18)} ${mark}  ${conf.padEnd(4)}  ${(p.score ?? '-').toString().padStart(5)} ${(p.margin ?? '-').toString().padStart(6)}  ${String(p.lineCount).padStart(5)} ${String(p.ms).padStart(5)}  ${p.evidence.join('; ')}`,
    );
    if (!p.expected) continue;
    t.exact += p.exact ? 1 : 0;
    t.confident += p.confident ? 1 : 0;
    t.confidentRight += p.confident && p.exact ? 1 : 0;
    t.confidentWrong += p.confident && !p.exact ? 1 : 0;
    t.inAlts += p.inAlternatives ? 1 : 0;
  }
  console.log(`  exact ${t.exact}/${img.pockets.filter((p) => p.expected).length} · confident ${t.confident} (right ${t.confidentRight}, wrong ${t.confidentWrong}) · expected among alternatives ${t.inAlts}\n`);
  totals.n += img.pockets.filter((p) => p.expected).length;
  for (const k of ['exact', 'confident', 'confidentRight', 'confidentWrong', 'inAlts']) totals[k] += t[k];
  totals.pageMs += img.pageMs;
  totals.hashMs += img.hashMs;
}
console.log(
  `all: exact ${totals.exact}/${totals.n} · confident ${totals.confident} (right ${totals.confidentRight}, wrong ${totals.confidentWrong}) · expected among alternatives ${totals.inAlts} · ${(totals.pageMs / 1000).toFixed(1)} s for ${results.images.length} pages (hash ${(totals.hashMs / 1000).toFixed(2)} s)`,
);
console.log(`\nJSON: node scripts/page-bench.mjs --game ${game} --json; expected cards: ${game === 'ygo' ? 'the .json sidecar of each page (scripts/synth-page.mjs); a passcode counts for any of its printings' : 'scripts/fixtures/binder-pages/README.md'}`);
process.exit(results.images.some((r) => r.error) ? 1 : 0);
