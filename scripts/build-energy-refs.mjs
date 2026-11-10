// References for basic Energy cards: public/data/energy-refs.json.
//
// Many basic Energy cards print no name, number or set code, only "ENERGY"
// and the type's symbol, so the scanner has no text to match, and the artwork
// hashes barely tell Darkness from Water of the same design. This file
// holds, per basic Energy printing that has a reference image, what does tell
// them apart (src/scanner/energy-features.ts): a small grey thumbnail of the
// big symbol and the mean colour of the art under it. src/scanner/energy.ts
// compares a photographed card against them.
//
//   npm run energy-refs            (after `npm run hashes`, which fills the image cache)
//
// Reads the reference images that scripts/build-hashes.mjs cached under
// scripts/.cache/images/pokemon/ (or $CARDCODEX_CACHE_DIR); a printing whose
// image is not cached is skipped and counted. No network. The features are
// computed by the app's own code, loaded through Vite's SSR module loader.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import sharp from 'sharp';
import { writeDataManifest } from './data-manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.resolve(process.env.CARDCODEX_CACHE_DIR || path.join(root, 'scripts', '.cache'));
const IMAGES = path.join(CACHE, 'images', 'pokemon');
const OUT = path.join(root, 'public', 'data', 'energy-refs.json');

const vite = await createServer({
  configFile: false,
  root,
  logLevel: 'error',
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, entries: [] },
  server: { middlewareMode: true, hmr: false },
  resolve: { alias: { '@': path.join(root, 'src') } },
});
try {
  const { BASIC_ENERGY, ENERGY_THUMB, energyColor, symbolCells } = await vite.ssrLoadModule(path.join(root, 'src/scanner/energy-features.ts'));
  const { lumaImage } = await vite.ssrLoadModule(path.join(root, 'src/scanner/hash.ts'));
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'public', 'data', 'catalog.json'), 'utf8'));
  const WHOLE = { x: 0, y: 0, w: 1, h: 1 };
  const ids = [];
  const rgb = [];
  const cells = [];
  const perType = new Map();
  let missing = 0;
  for (const card of catalog.cards) {
    const m = card.cat === 'Energy' ? BASIC_ENERGY.exec(card.name) : null;
    if (!m || !card.img) continue;
    const file = path.join(IMAGES, `${card.id}.webp`);
    if (!fs.existsSync(file)) {
      missing++;
      continue;
    }
    const { data, info } = await sharp(fs.readFileSync(file), { failOn: 'none' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    ids.push(card.id);
    rgb.push(...energyColor(data, info.width, info.height, WHOLE).map((v) => Math.round(v)));
    for (const v of symbolCells(lumaImage(data, info.width, info.height), WHOLE)) cells.push(Math.max(0, Math.min(255, Math.round(v))));
    perType.set(m[1], (perType.get(m[1]) ?? 0) + 1);
  }
  if (!ids.length) {
    console.error(`No cached Energy images under ${IMAGES}. Run \`npm run hashes\` first.`);
    process.exitCode = 1;
  } else {
    const out = { version: 1, builtAt: new Date().toISOString(), game: 'pokemon', thumb: ENERGY_THUMB, ids, rgb, symbols: Buffer.from(Uint8Array.from(cells)).toString('base64') };
    const json = JSON.stringify(out);
    fs.writeFileSync(OUT, json);
    console.log(`${ids.length} basic Energy printings with references (${missing} without a cached image)`);
    console.log(`  per type: ${[...perType].map(([t, n]) => `${t} ${n}`).join(', ')}`);
    console.log(`Wrote ${path.relative(root, OUT)} (${(json.length / 1024).toFixed(0)} KB, ${(zlib.gzipSync(json).length / 1024).toFixed(0)} KB gzipped)`);
    writeDataManifest();
  }
} finally {
  await vite.close();
}
