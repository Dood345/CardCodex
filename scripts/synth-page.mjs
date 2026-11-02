#!/usr/bin/env node
/**
 * Synthetic binder page from cached reference images, for the artwork-hash benches while real
 * photos are scarce: nine (cols × rows) cards pasted on a light page with the small shifts,
 * scales, blur and lighting a photo of a pocket page has, plus the expected ids beside it.
 *
 *   node scripts/synth-page.mjs --game ygo                    # → scripts/.cache/synth-pages/ygo-3x3.jpg (+ .json)
 *   node scripts/synth-page.mjs --game ygo --ids 46986414,…   # these cards (row-major; default: a mix of frames)
 *   node scripts/synth-page.mjs --game pokemon --ids sv03.5-010,base1-55,…
 *   options: --out FILE  --layout 3x3  --seed 1  --shift 0.02  --scale 0.06  --blur 1.2  --cache-dir DIR
 *
 * Yu-Gi-Oh! images are the YGOPRODeck small renders in scripts/.cache/images/ygo/<passcode>.jpg
 * (downloaded by `npm run hashes:ygo`; never hotlinked, and the page stays in the gitignored cache
 * like the renders themselves); Pokémon images the TCGdex low.webp files in images/pokemon/<id>.webp.
 * Per card (seeded, reproducible): shift up to ±`shift` of the cell, card 1−`scale`…1 of the cell,
 * Gaussian blur 0…`blur` px, brightness ×0.9…1.05, then a smooth lighting gradient across the page
 * and JPEG 85. The sidecar JSON lists `ids` row-major and the parameters.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Default cards per game: a spread of frames (Yu-Gi-Oh!) or eras (Pokémon). */
export const DEFAULT_IDS = {
  // effect · normal (Dark Magician) · link · xyz · spell · trap · effect_pendulum · synchro · fusion (alternate art)
  ygo: ['14558127', '46986414', '1861629', '84013237', '5318639', '44095762', '41546', '16178681', '1546124'],
  pokemon: ['sv03.5-010', 'base1-55', 'xy12-3', 'swsh10.5-016', 'dp2-56', 'sv09-003', 'xy1-3', 'base4-11', 'xy3-70'],
};

/** mulberry32 */
function rng(seed) {
  let a = (seed * 0x9e3779b9) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function imageFileFor(game, id, cacheDir) {
  return game === 'ygo' ? path.join(cacheDir, 'images', 'ygo', `${id}.jpg`) : path.join(cacheDir, 'images', 'pokemon', `${id}.webp`);
}

/**
 * Builds the page. `opts`: game, ids (row-major), cols, rows, seed, shift, scale, blur, cacheDir,
 * cardWidth (px of the pasted card at scale 1). Returns { buffer (JPEG), meta }.
 */
export async function synthPage(opts) {
  const game = opts.game ?? 'ygo';
  const cols = opts.cols ?? 3;
  const rows = opts.rows ?? 3;
  const ids = opts.ids ?? DEFAULT_IDS[game];
  if (ids.length !== cols * rows) throw new Error(`${cols}×${rows} page needs ${cols * rows} ids, got ${ids.length}`);
  const cacheDir = opts.cacheDir ?? process.env.CARDCODEX_CACHE_DIR ?? path.join(root, 'scripts', '.cache');
  const seed = opts.seed ?? 1;
  const maxShift = opts.shift ?? 0.02;
  const maxScale = opts.scale ?? 0.06;
  const maxBlur = opts.blur ?? 1.2;
  const r = rng(seed);
  const aspect = game === 'ygo' ? 59 / 86 : 63 / 88;
  const cardW = opts.cardWidth ?? 560;
  const cardH = Math.round(cardW / aspect);
  const gap = 0.05; // pocket gap: the cell is this much larger than the card
  const cellW = Math.round(cardW * (1 + gap));
  const cellH = Math.round(cardH * (1 + gap));
  const margin = Math.round(cellW * 0.12);
  const W = cols * cellW + 2 * margin;
  const H = rows * cellH + 2 * margin;

  const layers = [];
  const cards = [];
  for (let i = 0; i < ids.length; i++) {
    const file = imageFileFor(game, ids[i], cacheDir);
    if (!fs.existsSync(file)) throw new Error(`no cached image for ${ids[i]} (${path.relative(root, file)}); run the hash build first`);
    const col = i % cols;
    const row = Math.floor(i / cols);
    const scale = 1 - maxScale * r();
    const w = Math.round(cardW * scale);
    const h = Math.round(cardH * scale);
    const dx = (2 * r() - 1) * maxShift * cellW;
    const dy = (2 * r() - 1) * maxShift * cellH;
    const left = Math.round(margin + col * cellW + (cellW - w) / 2 + dx);
    const top = Math.round(margin + row * cellH + (cellH - h) / 2 + dy);
    const blur = maxBlur * r();
    const brightness = 0.9 + 0.15 * r();
    let img = sharp(file).flatten({ background: '#ffffff' }).resize(w, h, { fit: 'fill' }).modulate({ brightness });
    if (blur >= 0.3) img = img.blur(blur);
    // Rounded corners like a real card, over the pocket's light background.
    const mask = Buffer.from(`<svg width="${w}" height="${h}"><rect x="0" y="0" width="${w}" height="${h}" rx="${Math.round(w * 0.045)}" fill="#fff"/></svg>`);
    const buf = await img.composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
    layers.push({ input: buf, left, top });
    cards.push({ index: i, id: ids[i], box: { x: left, y: top, w, h }, scale: Math.round(scale * 1000) / 1000, shift: [Math.round(dx), Math.round(dy)], blur: Math.round(blur * 100) / 100, brightness: Math.round(brightness * 100) / 100 });
  }
  // The page: an off-white sheet with faint pocket seams, on a darker desk.
  const seams = Array.from({ length: cols * rows }, (_, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return `<rect x="${margin + col * cellW + 2}" y="${margin + row * cellH + 2}" width="${cellW - 4}" height="${cellH - 4}" fill="#f3f3f0" stroke="#d8d8d4" stroke-width="3"/>`;
  }).join('');
  const sheet = Buffer.from(
    `<svg width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#6b6a66"/><rect x="${margin / 2}" y="${margin / 2}" width="${W - margin}" height="${H - margin}" fill="#ecece8"/>${seams}</svg>`,
  );
  // Lighting: a smooth left-to-right, top-to-bottom gradient, multiplied in.
  const light = Buffer.from(
    `<svg width="${W}" height="${H}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#c8c8c8"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/></svg>`,
  );
  const buffer = await sharp(sheet).composite([...layers, { input: light, blend: 'multiply' }]).jpeg({ quality: 85 }).toBuffer();
  const meta = { game, layout: `${cols}x${rows}`, width: W, height: H, ids, seed, shift: maxShift, scale: maxScale, blur: maxBlur, page: { x: margin, y: margin, w: cols * cellW, h: rows * cellH }, cards };
  return { buffer, meta };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name, def) => {
    const i = args.indexOf(name);
    if (i === -1) return def;
    const v = args[i + 1];
    args.splice(i, 2);
    return v;
  };
  if (args.includes('--help') || args.includes('-h')) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*\n|^ \* ?/gm, ''));
    process.exit(0);
  }
  const game = opt('--game', 'ygo');
  const layout = opt('--layout', '3x3');
  const [cols, rows] = layout.split('x').map(Number);
  const cacheDir = path.resolve(opt('--cache-dir', process.env.CARDCODEX_CACHE_DIR || path.join(root, 'scripts', '.cache')));
  const out = path.resolve(opt('--out', path.join(root, 'scripts', '.cache', 'synth-pages', `${game}-${layout}.jpg`)));
  const idsOpt = opt('--ids', '');
  const { buffer, meta } = await synthPage({
    game,
    cols,
    rows,
    ids: idsOpt ? idsOpt.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    seed: Number(opt('--seed', '1')),
    shift: Number(opt('--shift', '0.02')),
    scale: Number(opt('--scale', '0.06')),
    blur: Number(opt('--blur', '1.2')),
    cacheDir,
  });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buffer);
  fs.writeFileSync(out.replace(/\.jpe?g$/i, '') + '.json', JSON.stringify(meta, null, 2) + '\n');
  console.log(`${path.relative(root, out)}: ${meta.width}×${meta.height}, ${cols}×${rows} ${game} cards (${buffer.length} bytes)`);
  for (const c of meta.cards) console.log(`  ${c.index}  ${c.id.padEnd(14)} scale ${c.scale}  shift ${c.shift.join(',')} px  blur ${c.blur}  brightness ${c.brightness}`);
}
