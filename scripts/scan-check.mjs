#!/usr/bin/env node
/**
 * Scanner reality check: runs the real Tesseract recognizer + parser + matcher
 * from src/scanner on real card images from TCGdex, in Node.
 *
 *   node scripts/scan-check.mjs            # summary per image
 *   node scripts/scan-check.mjs --verbose  # also print every OCR line
 *   node scripts/scan-check.mjs --psm 6    # try another page segmentation mode
 *
 * Images are downloaded once into scripts/.cache/scan/ (PNG: tesseract.js in
 * Node cannot decode WebP). "high" is 600×825 (a card filling the frame);
 * "low" is ~245×337, a stand-in for a card that fills ~1/4 of a 1280 px frame.
 * The eng model is cached in scripts/.cache/tess/.
 * If public/data/catalog.json exists, the matcher runs against it.
 *
 * The TS sources are loaded through Vite's SSR module loader (no build step), so this
 * exercises exactly the code the app ships.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = path.join(root, 'scripts', '.cache', 'scan');
const tessCache = path.join(root, 'scripts', '.cache', 'tess');
const catalogPath = path.join(root, 'public', 'data', 'catalog.json');

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const psmArg = args.includes('--psm') ? args[args.indexOf('--psm') + 1] : undefined;
const sizes = args.includes('--high-only') ? ['high'] : ['high', 'low'];

/**
 * [expected card id, TCGdex asset path, group]. "tuning" images were used to
 * tune the heuristics; "held-out" ones were added afterwards and never tuned
 * on — report them separately.
 */
const IMAGES = [
  ['sv01-057', 'sv/sv01/057', 'tuning'], // Wugtrio, SV-era Pokémon
  ['swsh3-136', 'swsh/swsh3/136', 'tuning'], // Furret, Sword & Shield
  ['base1-4', 'base/base1/4', 'tuning'], // Charizard, Base Set (no set code, "4/102")
  ['sv01-190', 'sv/sv01/190', 'tuning'], // Professor's Research, Trainer (full art)
  ['sv03-125', 'sv/sv03/125', 'tuning'], // Charizard ex, Obsidian Flames
  ['sv02-172', 'sv/sv02/172', 'tuning'], // Boss's Orders, Trainer
  ['bw1-32', 'bw/bw1/32', 'held-out'], // Samurott, Black & White
  ['xy1-41', 'xy/xy1/41', 'held-out'], // Greninja, XY
  ['sm1-100', 'sm/sm1/100', 'held-out'], // Tauros GX, Sun & Moon
  ['swsh4-127', 'swsh/swsh4/127', 'held-out'], // Aegislash VMAX
  ['sv06-144', 'sv/sv06/144', 'held-out'], // Caretaker, Trainer
];

async function download(assetPath, size) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const file = path.join(cacheDir, `${assetPath.replace(/\//g, '_')}_${size}.png`);
  if (!fs.existsSync(file)) {
    const url = `https://assets.tcgdex.net/en/${assetPath}/${size}.png`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return file;
}

// A middleware-mode dev server keeps its module runner open, so the lazy
// `import('tesseract.js')` inside tesseract.ts works (runnerImport closes it).
const vite = await createServer({ configFile: false, root, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false } });
const load = (p) => vite.ssrLoadModule(path.join(root, p));

const { TesseractRecognizer } = await load('src/scanner/tesseract.ts');
const { parseLines } = await load('src/scanner/parse.ts');
const { buildScanIndex, matchObservations } = await load('src/scanner/match.ts');

let index = null;
if (fs.existsSync(catalogPath)) {
  const t0 = performance.now();
  index = buildScanIndex(JSON.parse(fs.readFileSync(catalogPath, 'utf8')));
  console.log(`catalog: ${index.catalog.cards.length} cards, ${index.names.length} unique names; index built in ${Math.round(performance.now() - t0)} ms`);
} else {
  console.log('public/data/catalog.json not found: printing observations only.');
}

fs.mkdirSync(tessCache, { recursive: true });
const recognizer = new TesseractRecognizer({ cachePath: tessCache, ...(psmArg ? { psm: psmArg } : {}) });
await recognizer.init();

const summary = [];
for (const size of sizes) {
  for (const [expected, assetPath, group] of IMAGES) {
    const file = await download(assetPath, size);
    const t0 = performance.now();
    const lines = await recognizer.recognize(file);
    const ocrMs = Math.round(performance.now() - t0);
    const obs = parseLines(lines, index?.parseContext ?? {});
    console.log(`\n=== ${expected} [${size}] — ${lines.length} lines, OCR ${ocrMs} ms`);
    if (verbose) for (const l of lines) console.log(`  ${l.confidence.toFixed(2)} [${l.bbox.x},${l.bbox.y} ${l.bbox.w}x${l.bbox.h}] ${l.text}`);
    console.log(`  numbers: ${obs.numbers.map((n) => `${n.num}/${n.totalPrefix ?? ''}${n.total ?? '-'}(${n.quality}) "${n.raw}"`).join(', ') || '-'}`);
    console.log(`  set codes: ${obs.setCodes.map((c) => `${c.code}${c.distance ? '≈' + c.abbr : ''}`).join(', ') || '-'}`);
    console.log(`  hp: ${obs.hps.map((h) => `${h.hp}${h.explicit ? '' : '?'}`).join(', ') || '-'}`);
    let verdict = 'n/a';
    if (index) {
      const t1 = performance.now();
      const cands = matchObservations(obs, index);
      const matchMs = Math.round(performance.now() - t1);
      if (cands.length === 0) console.log(`  match (${matchMs} ms): nothing`);
      cands.forEach((c, i) => {
        console.log(
          `  match #${i + 1} (${matchMs} ms): ${c.card.id} "${c.card.name}" score ${c.score.toFixed(2)} margin ${c.margin.toFixed(2)}${c.confident ? ' CONFIDENT' : ''} — ${c.evidence.join('; ')}`,
        );
        console.log(`     alts: ${c.alternatives.slice(0, 4).map((a) => `${a.card.id} ${a.score.toFixed(2)}`).join(', ')}`);
      });
      const top = cands[0];
      const inAlts = cands.some((c) => c.card.id === expected || c.alternatives.some((a) => a.card.id === expected));
      verdict = top?.card.id === expected ? 'TOP-1' : inAlts ? 'in alternatives' : top ? `wrong (${top.card.id})` : 'no match';
    }
    summary.push({ image: `${expected} [${size}]`, group, ocrMs, lines: lines.length, result: verdict });
  }
}
await recognizer.dispose();
await vite.close();

console.log('\nSummary');
console.table(summary);
if (index) {
  for (const size of sizes) {
    for (const group of ['tuning', 'held-out']) {
      const rows = summary.filter((r) => r.image.endsWith(`[${size}]`) && r.group === group);
      if (!rows.length) continue;
      const top1 = rows.filter((r) => r.result === 'TOP-1').length;
      const alt = rows.filter((r) => r.result === 'in alternatives').length;
      console.log(`${size} ${group}: top-1 ${top1}/${rows.length}, in alternatives ${alt}, mean OCR ${Math.round(rows.reduce((s, r) => s + r.ocrMs, 0) / rows.length)} ms`);
    }
  }
}
