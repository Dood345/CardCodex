#!/usr/bin/env node
/**
 * Reads the labels printed on Pokémon cards off their pictures: Single Strike, Rapid Strike, Fusion
 * Strike, Ancient, Future and Tera. The card data (TCGdex) has no field for them, and card text depends
 * on them ("attacks used by your Future Pokémon", "can only be attached to a Single Strike Pokémon").
 *
 *   npm run labels              # read what is new, write scripts/card-labels.json, put the labels into public/data/text.json
 *   npm run labels -- --all     # read every set again, also those already read
 *   npm run labels -- --report  # read and report only, write nothing
 *
 * Only what has not been read yet is read: the record keeps, for each set, how many cards and pictures it
 * had when it was read, and a set whose numbers are the same is taken from the record as it stands. A new
 * set, a set that gained cards or pictures, and every set after a change to the templates or the threshold
 * are read (the first of these changes the set's numbers, the last the record's `method`).
 *
 * How: each label is a badge printed at a fixed place under the name bar. A template of the badge is cut
 * from one exemplar card and matched (normalised correlation over the three colour channels) against that place on every
 * card of the sets that can carry it, on the small pictures build-hashes.mjs already keeps
 * (scripts/.cache/images/pokemon/<id>.webp, 245 × 337): nothing is downloaded. Measured on 2026-11-12: a
 * card with the badge scores 0.6 to 0.99 and a card without it at most 0.49, and the counts for the two
 * promo sets equal the totals Scrydex's public expansion pages show for those labels.
 *
 * A text reader was tried first (Tesseract on the top band of the large picture): it read "Ancient" and
 * "Future" and the Tera rule sentence, and missed every Single Strike and Rapid Strike ribbon. The badges
 * are drawings, not type, so matching the drawing is the fitting tool; a stronger reader (PP-OCRv5) would
 * have added a model download and a dependency for a job the pictures already do.
 *
 * Printings that share their card text share their label (a full-art print of a Tera Pokémon ex is the
 * same card), so a label read on one printing goes to the others of the same text in the same era, which
 * also covers a print whose artwork hides the badge.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import crypto from 'node:crypto';
import { applyCardLabels, CARD_LABELS_FILE, LABELS, readCardLabels } from './card-labels.mjs';
import { writeDataManifest } from './data-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const setsArg = args.indexOf('--sets');
/** `--sets swsh5,sv04`: read these sets only, for a quick look (implies --report). */
const ONLY_SETS = setsArg >= 0 ? new Set(args[setsArg + 1].split(',')) : null;
const REPORT_ONLY = args.includes('--report') || !!ONLY_SETS;
/** Read every set, whatever the record says was read before. */
const ALL = args.includes('--all') || !!ONLY_SETS;
const cacheArg = args.indexOf('--cache-dir');
const CACHE = path.resolve(cacheArg >= 0 ? args[cacheArg + 1] : process.env.CARDCODEX_CACHE_DIR || path.join(ROOT, 'scripts', '.cache'));
const IMG = path.join(CACHE, 'images', 'pokemon');
const DATA = path.join(ROOT, 'public', 'data');
const W = 245;
const H = 337;

/**
 * The sets a label can be in. By series, not by date: a promo set runs for years (the Sword & Shield
 * promos start in 2019 and hold the Battle Styles promos of 2021). The Strike labels are in the Sword &
 * Shield series; Ancient, Future and Tera in everything released since 2023 outside it.
 */
const STRIKE = (set) => set.series === 'swsh';
const PARADOX = (set) => set.series !== 'swsh' && (set.releaseDate ?? '') >= '2023-01-01';

/**
 * One badge template: the label, the card it is cut from, the box on that card (fractions of the picture)
 * and the era. Two templates for a label whose badge is drawn at two sizes; the better match counts.
 */
export const TEMPLATES = [
  { label: 'Single Strike', exemplar: 'swsh5-97', box: [0.675, 0.1, 0.965, 0.16], era: STRIKE },
  { label: 'Rapid Strike', exemplar: 'swsh5-37', box: [0.675, 0.1, 0.965, 0.16], era: STRIKE },
  // The same ribbon on the black and gold of a Trainer Gallery VMAX, where the first template matched at 0.55.
  { label: 'Rapid Strike', exemplar: 'swsh12tg-TG29', box: [0.65, 0.104, 0.963, 0.166], era: STRIKE },
  { label: 'Fusion Strike', exemplar: 'swsh8-113', box: [0.64, 0.098, 0.955, 0.165], era: STRIKE },
  // On a Trainer, under the taller name bar and on a lighter ground (0.58 with the Pokémon's template).
  { label: 'Fusion Strike', exemplar: 'swsh8-236', box: [0.643, 0.145, 0.955, 0.208], era: STRIKE },
  { label: 'Ancient', exemplar: 'sv04-124', box: [0.665, 0.1, 0.975, 0.158], era: PARADOX },
  { label: 'Ancient', exemplar: 'sv04-159', box: [0.66, 0.148, 0.955, 0.208], era: PARADOX },
  { label: 'Future', exemplar: 'sv04-089', box: [0.665, 0.1, 0.975, 0.158], era: PARADOX },
  { label: 'Future', exemplar: 'sv04-164', box: [0.66, 0.148, 0.955, 0.208], era: PARADOX },
  { label: 'Tera', exemplar: 'sv03-125', box: [0.69, 0.094, 0.82, 0.12], era: PARADOX },
];

/** A match at or above this carries the label; one in the band below it is listed for a look. */
export const THRESHOLD = 0.58;
const DOUBT = 0.5;
/**
 * The badge may sit a little to either side of, and well below, where it is on its exemplar: a Trainer's
 * is under a taller name bar, and a card can carry several, stacked (Deoxys of Fusion Strike has all three
 * Strike badges one under the other, the third 42 px down).
 */
const DX = 6;
const UP = 4;
const DOWN = 46;

/** The picture as W × H × 3 bytes (red, green, blue), or null when the cache has none. */
/**
 * What the reading depends on besides the pictures: a record made with other templates, another threshold
 * or another search window says nothing about what this run would find, so its sets are all read again.
 * Raise METHOD_VERSION when the matching itself changes.
 */
const METHOD_VERSION = 1;
const methodOf = () =>
  crypto
    .createHash('md5')
    .update(JSON.stringify({ v: METHOD_VERSION, t: TEMPLATES.map((t) => [t.label, t.exemplar, t.box]), THRESHOLD, DX, UP, DOWN, W, H }))
    .digest('hex')
    .slice(0, 12);

async function pixels(id) {
  const file = path.join(IMG, `${id}.webp`);
  if (!fs.existsSync(file)) return null;
  const { data } = await sharp(file).resize(W, H, { fit: 'fill' }).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  return data;
}

async function cut(t) {
  const g = await pixels(t.exemplar);
  if (!g) throw new Error(`no picture of the exemplar ${t.exemplar} in ${IMG}: run \`npm run hashes\` first`);
  const [x0, y0, x1, y1] = t.box;
  const tx = Math.round(x0 * W);
  const ty = Math.round(y0 * H);
  const tw = Math.round((x1 - x0) * W);
  const th = Math.round((y1 - y0) * H);
  // All three colour channels, about one mean: the colour of a badge counts as much as its drawing. In grey
  // levels a Fusion Strike ribbon (purple) matched the Single Strike one (red) as well as its own.
  const px = new Float32Array(tw * th * 3);
  let mean = 0;
  for (let y = 0; y < th; y++) for (let x = 0; x < tw * 3; x++) mean += px[y * tw * 3 + x] = g[((ty + y) * W + tx) * 3 + x];
  mean /= px.length;
  let norm = 0;
  for (let i = 0; i < px.length; i++) norm += (px[i] -= mean) ** 2;
  return { ...t, tx, ty, tw, th, px, norm: Math.sqrt(norm) };
}

/** Best normalised correlation of the template with the picture, around the template's own place. */
function match(g, t) {
  let best = -1;
  for (let oy = t.ty - UP; oy <= t.ty + DOWN; oy++) {
    for (let ox = t.tx - DX; ox <= t.tx + DX; ox++) {
      if (ox < 0 || oy < 0 || ox + t.tw > W || oy + t.th > H) continue;
      const n = t.tw * 3;
      let sum = 0;
      for (let y = 0; y < t.th; y++) {
        const row = ((oy + y) * W + ox) * 3;
        for (let x = 0; x < n; x++) sum += g[row + x];
      }
      const mean = sum / t.px.length;
      let dot = 0;
      let norm = 0;
      for (let y = 0; y < t.th; y++) {
        const row = ((oy + y) * W + ox) * 3;
        const trow = y * n;
        for (let x = 0; x < n; x++) {
          const v = g[row + x] - mean;
          dot += v * t.px[trow + x];
          norm += v * v;
        }
      }
      const c = norm > 0 ? dot / (Math.sqrt(norm) * t.norm) : 0;
      if (c > best) best = c;
    }
  }
  return best;
}

export async function readLabels({ log = () => {} } = {}) {
  const catalog = JSON.parse(fs.readFileSync(path.join(DATA, 'catalog.json'), 'utf8'));
  const text = JSON.parse(fs.readFileSync(path.join(DATA, 'text.json'), 'utf8'));
  const sets = new Map(catalog.sets.map((s) => [s.id, s]));
  const inEra = (card, era) => {
    const set = sets.get(card.set);
    return !!set && era(set);
  };
  const templates = [];
  for (const t of TEMPLATES) templates.push(await cut(t));
  const textIndex = new Map(text.ids.map((id, i) => [id, text.ti[i]]));
  const byId = new Map(catalog.cards.map((c) => [c.id, c]));

  // What each set that can carry a label looks like now, and which of them the record already covers.
  const method = methodOf();
  const previous = ALL ? null : readCardLabels();
  const counts = new Map();
  for (const card of catalog.cards) {
    if (!templates.some((t) => inEra(card, t.era))) continue;
    const c = counts.get(card.set) ?? { cards: 0, pictures: 0 };
    c.cards++;
    if (fs.existsSync(path.join(IMG, `${card.id}.webp`))) c.pictures++;
    counts.set(card.set, c);
  }
  const signature = Object.fromEntries([...counts].sort().map(([id, c]) => [id, `${c.cards}/${c.pictures}`]));
  const unchanged = new Set(previous?.method === method ? Object.keys(signature).filter((id) => previous.read?.[id] === signature[id]) : []);
  log(`sets that can carry a label: ${counts.size}; already read and unchanged: ${unchanged.size}; to read: ${counts.size - unchanged.size}`);

  /** label → Map(card id → score), for the cards read with the badge; and those in doubt. */
  const read = new Map(LABELS.map((l) => [l, new Map()]));
  // The labels of the sets not read again come from the record (no score: they were judged when they were read).
  for (const label of LABELS) for (const id of previous?.labels?.[label] ?? []) if (byId.has(id) && unchanged.has(byId.get(id).set)) read.get(label).set(id, Number.NaN);
  const doubt = [];
  const perSet = new Map();
  let pictures = 0;
  let missing = 0;
  for (const card of catalog.cards) {
    if (ONLY_SETS && !ONLY_SETS.has(card.set)) continue;
    if (unchanged.has(card.set)) continue;
    const mine = templates.filter((t) => inEra(card, t.era));
    if (!mine.length) continue;
    const g = await pixels(card.id);
    if (!g) {
      missing++;
      continue;
    }
    pictures++;
    const best = new Map();
    for (const t of mine) best.set(t.label, Math.max(best.get(t.label) ?? -1, match(g, t)));
    for (const [label, score] of best) {
      if (score >= THRESHOLD) {
        read.get(label).set(card.id, score);
        const key = `${card.set} ${label}`;
        perSet.set(key, (perSet.get(key) ?? 0) + 1);
      } else if (score >= DOUBT) doubt.push({ id: card.id, name: card.name, label, score });
    }
  }

  // Printings of one card (the same name and the same text) share the label, within the label's era. The
  // name is part of it: TCGdex gives two differently named Trainers the same text here and there.
  const labels = {};
  const spread = [];
  for (const label of LABELS) {
    const era = TEMPLATES.find((t) => t.label === label).era;
    const texts = new Set();
    const keyOf = (card) => (textIndex.has(card.id) ? `${textIndex.get(card.id)}|${card.name}` : null);
    for (const id of read.get(label).keys()) {
      const key = keyOf(byId.get(id));
      if (key) texts.add(key);
    }
    const ids = new Set(read.get(label).keys());
    for (const card of catalog.cards) {
      if (ids.has(card.id) || !inEra(card, era)) continue;
      const key = keyOf(card);
      if (!key || !texts.has(key)) continue;
      ids.add(card.id);
      spread.push({ id: card.id, name: card.name, label });
    }
    labels[label] = [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }
  // Cards with more than one label, for a look: few have several, and none should be both Ancient and Future.
  const several = new Map();
  for (const label of LABELS) for (const id of labels[label]) several.set(id, [...(several.get(id) ?? []), label]);
  const clashes = [...several].filter(([, ls]) => ls.length > 1).map(([id, ls]) => `${id} ${byId.get(id).name}: ${ls.join(', ')}`);
  log(`pictures read: ${pictures} (${missing} cards of those sets have no picture in the cache)`);
  for (const label of LABELS) {
    const all = [...read.get(label).values()];
    const scores = all.filter((v) => !Number.isNaN(v)).sort((a, b) => a - b);
    log(`${label}: ${labels[label].length} cards (${scores.length} read off a picture now, lowest match ${scores[0]?.toFixed(2) ?? '-'}; ${all.length - scores.length} from the record; ${labels[label].length - all.length} by sharing a printing's text)`);
  }
  return { labels, doubt, spread, clashes, perSet, byId, read, method, signature };
}

async function main() {
  const { labels, doubt, spread, clashes, perSet, byId, read, method, signature } = await readLabels({ log: console.log });
  if (args.includes('--lowest')) {
    for (const [label, scores] of read) console.log(`lowest ${label}: ${[...scores].filter(([, v]) => !Number.isNaN(v)).sort((a, b) => a[1] - b[1]).slice(0, 12).map(([id, v]) => `${id}=${v.toFixed(2)}`).join(' ')}`);
  }
  console.log(`\nby set: ${[...perSet].sort().map(([k, n]) => `${k} ${n}`).join(' | ')}`);
  console.log(`\nin doubt (match between ${DOUBT} and ${THRESHOLD}, not labelled): ${doubt.length}`);
  for (const d of doubt.sort((a, b) => b.score - a.score)) console.log(`  ${d.id} ${d.name}: ${d.label} ${d.score.toFixed(2)}`);
  console.log(`\nlabelled by sharing a printing's text: ${spread.length}`);
  for (const s of spread.slice(0, 40)) console.log(`  ${s.id} ${s.name}: ${s.label}`);
  console.log(`\ncards with more than one label: ${clashes.length}`);
  for (const c of clashes) console.log(`  ${c}`);
  if (clashes.some((c) => /Ancient, Future/.test(c))) {
    console.error('\na card read as both Ancient and Future: look at it before trusting the run');
    process.exit(1);
  }
  // Names that say their label must have been read with it.
  const misses = [];
  for (const label of ['Single Strike', 'Rapid Strike', 'Fusion Strike']) {
    const have = new Set(labels[label]);
    for (const c of byId.values()) if (c.name.startsWith(`${label} `) && !have.has(c.id) && fs.existsSync(path.join(IMG, `${c.id}.webp`))) misses.push(`${c.id} ${c.name}`);
  }
  if (misses.length) {
    console.error(`\ncards named for a label that was not read on them:\n  ${misses.join('\n  ')}`);
    process.exit(1);
  }
  if (REPORT_ONLY) return;
  // `read`: cards and pictures of each set when it was read; `method`: what the reading was made with.
  const record = { version: 1, builtAt: new Date().toISOString(), source: 'read off the card pictures by scripts/build-labels.mjs', method, read: signature, labels };
  fs.writeFileSync(CARD_LABELS_FILE, `${JSON.stringify(record, null, 1)}\n`);
  const textPath = path.join(DATA, 'text.json');
  const text = JSON.parse(fs.readFileSync(textPath, 'utf8'));
  const n = applyCardLabels(text, record);
  fs.writeFileSync(textPath, JSON.stringify(text));
  writeDataManifest(DATA);
  console.log(`\nwrote ${path.relative(ROOT, CARD_LABELS_FILE)} and ${n} labels into public/data/text.json`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
