#!/usr/bin/env node
/**
 * Binder-page grid-fit benchmark: runs fitGridOnSource (src/scanner/grid.ts) on photos
 * exactly as the app does — in a browser, through the Vite dev server — and prints the
 * confidence, the fitted page box (pixels and fractions of the photo) and the fit time.
 *
 *   node scripts/grid-bench.mjs                      # the two fixtures in scripts/fixtures/binder-pages/
 *   node scripts/grid-bench.mjs --negatives          # + the local-only photos in scripts/.cache/scan-real/
 *   node scripts/grid-bench.mjs path/to/photo.jpg … # any photos (relative to the repo or absolute)
 *   options: --layout 3x3  --sample 320  --repeats 5  --json  --chrome <path to chrome.exe>
 *
 * How: a Vite dev server is started in-process (random free port, this repo's vite.config.ts),
 * a headless Chrome (CHROME_PATH, else the usual install locations; Edge works too) opens
 * scripts/grid-bench.html, which fetches each photo, decodes it with createImageBitmap
 * (EXIF orientation applied, like the app) and POSTs the results back to /__grid-bench.
 * Chrome runs with --disable-gpu and its own profile under scripts/.cache/chrome-profile.
 * Compare the numbers with scripts/fixtures/binder-pages/README.md.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(root, 'scripts', 'fixtures', 'binder-pages');
const NEGATIVES = path.join(root, 'scripts', '.cache', 'scan-real');

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
const layout = opt('--layout', '3x3');
const sample = opt('--sample', '320');
const repeats = opt('--repeats', '5');
const chromeOpt = opt('--chrome', process.env.CHROME_PATH);
const jsonOnly = flag('--json');
const negatives = flag('--negatives');
if (flag('--help') || flag('-h')) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*\n|^ \* ?/gm, ''));
  process.exit(0);
}

let photos = args.map((p) => path.resolve(root, p));
if (photos.length === 0) {
  photos = fs.readdirSync(FIXTURES).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort().map((f) => path.join(FIXTURES, f));
  if (negatives && fs.existsSync(NEGATIVES)) {
    photos.push(...fs.readdirSync(NEGATIVES).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort().map((f) => path.join(NEGATIVES, f)));
  } else if (negatives) {
    console.error(`(no ${path.relative(root, NEGATIVES)} folder on this machine: the negatives are local-only)`);
  }
}
for (const p of photos) if (!fs.existsSync(p)) {
  console.error(`not found: ${p}`);
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

/** URL path the dev server serves a file at: inside the repo → /relative, elsewhere → /@fs/abs. */
function servedPath(abs) {
  const rel = path.relative(root, abs);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return '/' + rel.split(path.sep).join('/');
  return '/@fs/' + abs.split(path.sep).join('/').replace(/^\//, '');
}

let resolveReport;
const report = new Promise((r) => (resolveReport = r));
const reportPlugin = {
  name: 'grid-bench-report',
  configureServer(server) {
    server.middlewares.use('/__grid-bench', (req, res) => {
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
  layout,
  sample,
  repeats,
  report: '/__grid-bench',
});
const url = `${base}scripts/grid-bench.html?${query}`;

const chrome = findChrome();
const profile = path.join(root, 'scripts', '.cache', 'chrome-profile');
fs.mkdirSync(profile, { recursive: true });
if (!jsonOnly) console.log(`vite ${base} · ${path.basename(chrome)} headless · ${photos.length} photo(s), layout ${layout}, sample ${sample} px, ${repeats} fits each`);
const proc = spawn(
  chrome,
  ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio', `--user-data-dir=${profile}`, '--window-size=1280,900', url],
  { stdio: 'ignore' },
);
const timeoutMs = 180_000;
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
} else {
  const name = (r) => path.basename(r.image);
  const w = Math.max(10, ...results.map((r) => name(r).length));
  console.log(`\n${'photo'.padEnd(w)}  ${'pixels'.padEnd(11)}  fit  conf   box frac x,y,w,h             fit ms (median)`);
  for (const r of results) {
    if (r.error) {
      console.log(`${name(r).padEnd(w)}  ERROR ${r.error}`);
      continue;
    }
    const px = `${r.width}×${r.height}`.padEnd(11);
    const fit = r.fit ? 'yes' : 'no ';
    const conf = r.fit ? r.confidence.toFixed(2) : ' -  ';
    const frac = r.fit ? `${r.frac.x.toFixed(3)},${r.frac.y.toFixed(3)},${r.frac.w.toFixed(3)},${r.frac.h.toFixed(3)}` : '';
    console.log(`${name(r).padEnd(w)}  ${px}  ${fit}  ${conf}   ${frac.padEnd(27)}  ${r.fitMs.median.toFixed(1)}`);
  }
  console.log(`\nJSON: node scripts/grid-bench.mjs --json; baselines: scripts/fixtures/binder-pages/README.md`);
}
process.exit(results.some((r) => r.error) ? 1 : 0);
