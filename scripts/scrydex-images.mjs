#!/usr/bin/env node
/**
 * Pictures for the Pokémon cards TCGdex has none for, from Scrydex (https://scrydex.com), used with
 * their written permission of 2026-11-12 (docs/scrydex-permission.md).
 *
 * build-catalog.mjs calls fillScrydexImages() for the cards still without a picture after its TCGdex
 * probes. On its own, this file reports what a build would do, from the catalog on disk:
 *
 *   node scripts/scrydex-images.mjs            # coverage per set, the cards Scrydex lacks, name mismatches
 *
 * How a card gets its picture, and why it is done this way:
 *  - Scrydex asks never to assume image URLs, and its ids are not TCGdex ids (`me06` is `me6`, the
 *    McDonald's sets are `mcd21`, the Trainer Kits `tk4a`…). So nothing is guessed: the ids, the card
 *    names and the image URLs are read from Scrydex's public expansion pages
 *    (scrydex.com/pokemon/expansions/<slug>/<id>), which list every card of an expansion.
 *  - A TCGdex set is paired with a Scrydex expansion by id, by name or by the short alias table below,
 *    and a card with the expansion's card of the same number only when the names agree. Where a
 *    set's numbering differs between the two sources, a card is paired by name alone if that name
 *    occurs exactly once on both sides. A card that fits neither way keeps its card back.
 *  - Scrydex answers an id without a picture with HTTP 200 and a card back, so the small picture is
 *    downloaded and its bytes compared with that placeholder before the card is marked. The file lands
 *    in the image cache where build-hashes.mjs expects it (images/pokemon/<card id>.webp, whatever its
 *    real format), so the picture is fetched once for both builds.
 *
 * Requests are paced (four per second), sent with a descriptive User-Agent and cached under
 * scripts/.cache/scrydex/ (or $CARDCODEX_CACHE_DIR/scrydex/): the expansion pages for a week, the
 * pictures for good. A rerun inside the week makes no request at all.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://scrydex.com';
export const SCRYDEX_IMAGES = 'https://images.scrydex.com';
const UA = 'CardCodex build-catalog (github.com/Dood345/CardCodex; card pictures used with permission, paced and cached)';
const GAP_MS = 250;
const TTL_MS = 7 * 24 * 3600 * 1000;

/**
 * TCGdex set id → Scrydex expansion id, for the sets whose ids and names both differ. Each was read off
 * Scrydex's expansion list, and the card names must still agree before any picture is used.
 */
const ALIAS = {
  'tk-hs-g': 'tk4b', // "HS trainer Kit (Gyarados)" / "HGSS Trainer Kit Gyarados"
  'tk-hs-r': 'tk4a', // "HS trainer Kit (Raichu)" / "HGSS Trainer Kit Raichu"
  'ex5.5': 'wb1', // "Poké Card Creator Pack"
  hgssp: 'hsp', // "HGSS Black Star Promos"
  '30th-c': 'me55c', // "30th Classic Collection" / "30th Celebration: Classic Collection"
  cel25cc: 'cel25c', // "Celebrations Classic Collection" / "Celebrations: Classic Collection"
  bog: 'bp', // "Best of game" / "Best of Game"
  exu: 'ex10', // "Unseen Forces Unown Collection": Scrydex lists the Unown cards inside Unseen Forces
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex');

/**
 * What Scrydex sends for an id it has no picture of: a card back, with status 200. Returns `{ md5, bytes }` of
 * that body (asked once a week), so a caller can tell it from a card's picture. `get` fetches a URL to
 * `{ body }`; the default is a plain fetch.
 */
export async function scrydexPlaceholder(cacheDir, { noCache = false, get } = {}) {
  const file = path.join(cacheDir, 'scrydex', 'placeholder.json');
  if (!noCache && fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < TTL_MS) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const url = `${SCRYDEX_IMAGES}/pokemon/cardcodex-no-such-card/small`;
  let body;
  if (get) body = (await get(url)).body;
  else {
    const res = await fetch(url, { headers: { 'user-agent': UA } });
    if (!res.ok) throw new Error(`Scrydex request failed: HTTP ${res.status} for ${url}`);
    body = Buffer.from(await res.arrayBuffer());
  }
  const placeholder = { md5: md5(body), bytes: body.length };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(placeholder));
  return placeholder;
}

const ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/g, (m, n) => ENTITIES[n] ?? m);
}

/** Name key: case, accents, punctuation and spacing do not count ("Pokémon Breeder's Fields" = "Pokemon Breeders Fields"). */
export function nameKey(name) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
}

/** Name key for pairing: TCGdex calls the basic Energy cards "Grass Energy", Scrydex "Basic Grass Energy". */
const pairKey = (name) => nameKey(name).replace(/^basic(?=[a-z]+energy$)/, '');

/** Number key: "001" = "1", "SM01" = "SM1", "tg05" = "TG5"; TCGdex writes the "?" Unown as "%3F". */
export function numberKey(num) {
  let n = String(num);
  try {
    n = decodeURIComponent(n);
  } catch {
    /* not percent-encoded */
  }
  return n.toUpperCase().replace(/^([A-Z]*)0+(?=\d)/, '$1');
}

/** The expansion list: `[{ id, slug, name }]`, English expansions only (the others carry a language suffix, `sv1_ja`). */
export function parseExpansionList(html) {
  const out = new Map();
  const re = /href="\/pokemon\/expansions\/([^"/?]+)\/([^"/?]+)"[^>]*>(?:\s*<div[^>]*>\s*<\/div>)?\s*(?:<span[^>]*>([^<]*)<\/span>)?/g;
  for (const [, slug, id, label] of html.matchAll(re)) {
    if (/_[a-z]{2}$/.test(id)) continue;
    const name = label ? decodeEntities(label).trim() : '';
    const prev = out.get(id);
    if (!prev || (!prev.name && name)) out.set(id, { id, slug, name: name || prev?.name || '' });
  }
  return [...out.values()];
}

/**
 * The cards on one expansion page: `{ cards: [{ id, name, num, image }], next }`. `image` is the picture's base
 * URL as the page gives it, without the size ("https://images.scrydex.com/pokemon/sve-1"); `next` the path
 * of the following page, if any.
 */
export function parseExpansionPage(html) {
  const cards = [];
  const seen = new Set();
  const blocks = html.split('data-id="').slice(1);
  for (const block of blocks) {
    const id = block.slice(0, block.indexOf('"'));
    if (!id || id.startsWith('expansion-') || seen.has(id)) continue;
    const img = /<img[^>]*\ssrc="(https:\/\/images\.scrydex\.com\/[^"]+)"/.exec(block);
    const label = /<span class="text-body-12 text-white text-center">([^<]*)<\/span>/.exec(block);
    if (!img || !label) continue;
    const text = decodeEntities(label[1]).trim();
    const cut = text.lastIndexOf(' #');
    if (cut < 0) continue;
    seen.add(id);
    cards.push({ id, name: text.slice(0, cut).trim(), num: text.slice(cut + 2).trim(), image: img[1].replace(/\/[a-z]+$/, '') });
  }
  const next = /<a href="([^"]+)" aria-label="Next">/.exec(html);
  return { cards, next: next ? decodeEntities(next[1]) : undefined };
}

/** Scrydex expansion ids worth trying for a TCGdex set, most specific first. */
export function expansionCandidates(set, expansions) {
  const ids = new Set(expansions.map((e) => e.id));
  const out = [];
  const add = (id) => {
    if (id && ids.has(id) && !out.includes(id)) out.push(id);
  };
  add(ALIAS[set.id]);
  add(set.id);
  add(set.id.replace(/\./g, ''));
  add(set.id.replace(/^([a-z]+)0+(\d)/, '$1$2').replace(/\./g, ''));
  const key = nameKey(set.name);
  for (const e of expansions) if (nameKey(e.name) === key || nameKey(e.slug) === key) add(e.id);
  return out;
}

/**
 * Pairs the catalog cards of one set with an expansion's cards. Returns `{ pairs: Map(card → scrydex card),
 * byName, mismatched }`: `byName` counts the pairs made by unique name, `mismatched` lists the cards whose number
 * exists on the other side under another name.
 */
export function pairCards(cards, setCards, expansionCards) {
  const byNum = new Map(expansionCards.map((x) => [numberKey(x.num), x]));
  const count = (list) => {
    const m = new Map();
    for (const x of list) m.set(pairKey(x.name), (m.get(pairKey(x.name)) ?? 0) + 1);
    return m;
  };
  const ours = count(setCards);
  const theirs = count(expansionCards);
  const theirByName = new Map(expansionCards.map((x) => [pairKey(x.name), x]));
  const pairs = new Map();
  const mismatched = [];
  let byName = 0;
  for (const card of cards) {
    const key = pairKey(card.name);
    const same = byNum.get(numberKey(card.num));
    if (same && pairKey(same.name) === key) {
      pairs.set(card, same);
      continue;
    }
    if (ours.get(key) === 1 && theirs.get(key) === 1) {
      pairs.set(card, theirByName.get(key));
      byName++;
      continue;
    }
    if (same) mismatched.push(`${card.id} "${card.name}" vs ${same.id} "${same.name}"`);
  }
  return { pairs, byName, mismatched };
}

/**
 * Marks every card of `pending` that Scrydex has a picture for: `card.img = "<image base URL>"`.
 * `pending` are catalog cards without `img`; `allCards` the whole catalog (a set's names decide whether a
 * name is unique); `sets` the catalog sets. Throws when Scrydex cannot be reached: a build that silently
 * dropped these pictures would also drop their scanner hashes.
 */
export async function fillScrydexImages({ pending, allCards, sets, cacheDir, noCache = false, log = console.log }) {
  const dir = path.join(cacheDir, 'scrydex');
  const images = path.join(cacheDir, 'images', 'pokemon');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(images, { recursive: true });
  const stats = { pending: pending.length, marked: 0, byName: 0, noExpansion: 0, notListed: 0, placeholder: 0, requests: 0, perSet: {}, mismatched: [], unpaired: [] };
  if (!pending.length) return stats;

  let lastAt = 0;
  async function get(url) {
    let err;
    for (let attempt = 0; attempt < 4; attempt++) {
      const wait = lastAt + GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      lastAt = Date.now();
      stats.requests++;
      try {
        const res = await fetch(url, { headers: { 'user-agent': UA } });
        if (res.ok) return { type: res.headers.get('content-type') || '', body: Buffer.from(await res.arrayBuffer()) };
        err = new Error(`HTTP ${res.status} for ${url}`);
        if (res.status === 404) break;
      } catch (e) {
        err = e;
      }
      await sleep(1500 * (attempt + 1));
    }
    throw new Error(`Scrydex request failed: ${err?.message ?? err}`);
  }
  /** A text page, cached for a week. */
  async function page(file, url) {
    const p = path.join(dir, file);
    if (!noCache && fs.existsSync(p) && Date.now() - fs.statSync(p).mtimeMs < TTL_MS) return fs.readFileSync(p, 'utf8');
    const text = (await get(url)).body.toString('utf8');
    fs.writeFileSync(p, text);
    return text;
  }

  const expansions = parseExpansionList(await page('expansions.html', `${SITE}/pokemon/expansions`));
  if (expansions.length < 100) throw new Error(`Scrydex expansion list: only ${expansions.length} expansions parsed; the page layout may have changed`);
  const slugOf = new Map(expansions.map((e) => [e.id, e.slug]));

  const expansionCache = new Map();
  async function expansionCards(id) {
    if (expansionCache.has(id)) return expansionCache.get(id);
    const cards = [];
    let url = `/pokemon/expansions/${slugOf.get(id)}/${id}`;
    for (let n = 1; url && n <= 12; n++) {
      const parsed = parseExpansionPage(await page(`expansion-${id}-${n}.html`, SITE + url));
      cards.push(...parsed.cards);
      url = parsed.next;
    }
    expansionCache.set(id, cards);
    return cards;
  }

  const placeholder = await scrydexPlaceholder(cacheDir, { noCache, get });
  // Cards whose picture was the placeholder last time: not asked again for a week.
  const missFile = path.join(dir, 'no-picture.json');
  let misses = {};
  if (!noCache && fs.existsSync(missFile)) {
    try {
      misses = JSON.parse(fs.readFileSync(missFile, 'utf8'));
    } catch {
      misses = {};
    }
  }

  /** True when Scrydex serves a real picture for the pair; the bytes are kept for the hash build. */
  async function hasPicture(card, theirs) {
    const file = path.join(images, `${card.id}.webp`);
    if (fs.existsSync(file)) return md5(fs.readFileSync(file)) !== placeholder.md5;
    const miss = misses[card.id];
    if (miss && miss.image === theirs.image && Date.now() - miss.at < TTL_MS) return false;
    const res = await get(`${theirs.image}/small`);
    if (!res.type.startsWith('image/') || res.body.length < 2000 || md5(res.body) === placeholder.md5) {
      misses[card.id] = { image: theirs.image, at: Date.now() };
      return false;
    }
    delete misses[card.id];
    fs.writeFileSync(file, res.body);
    return true;
  }

  const bySet = new Map();
  for (const card of pending) (bySet.get(card.set) ?? bySet.set(card.set, []).get(card.set)).push(card);
  const setById = new Map(sets.map((s) => [s.id, s]));
  const setCardsOf = new Map();
  for (const c of allCards) if (bySet.has(c.set)) (setCardsOf.get(c.set) ?? setCardsOf.set(c.set, []).get(c.set)).push(c);

  for (const [setId, cards] of bySet) {
    const row = (stats.perSet[setId] = { gaps: cards.length, marked: 0, expansion: null });
    let best = null;
    for (const id of expansionCandidates(setById.get(setId), expansions)) {
      const paired = pairCards(cards, setCardsOf.get(setId), await expansionCards(id));
      if (!best || paired.pairs.size > best.paired.pairs.size) best = { id, paired };
    }
    if (!best) {
      stats.noExpansion += cards.length;
      continue;
    }
    row.expansion = best.id;
    stats.mismatched.push(...best.paired.mismatched);
    for (const card of cards) {
      const theirs = best.paired.pairs.get(card);
      if (!theirs) {
        stats.notListed++;
        stats.unpaired.push(card.id);
        continue;
      }
      if (await hasPicture(card, theirs)) {
        card.img = theirs.image;
        row.marked++;
        stats.marked++;
      } else stats.placeholder++;
    }
    stats.byName += [...best.paired.pairs.keys()].filter((c) => c.img && numberKey(best.paired.pairs.get(c).num) !== numberKey(c.num)).length;
    log(`  ${setId.padEnd(12)} ${String(row.marked).padStart(3)}/${String(row.gaps).padEnd(3)} from ${best.id}`);
  }
  fs.writeFileSync(missFile, JSON.stringify(misses));
  return stats;
}

// ---------------------------------------------------------------- report (run on its own)
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'catalog.json'), 'utf8'));
  // Start from the catalog as TCGdex alone leaves it: the cards a build would hand over.
  for (const c of catalog.cards) if (typeof c.img === 'string' && c.img.startsWith(SCRYDEX_IMAGES)) delete c.img;
  const pending = catalog.cards.filter((c) => !c.img);
  const cacheDir = process.env.CARDCODEX_CACHE_DIR || path.join(ROOT, 'scripts', '.cache');
  const stats = await fillScrydexImages({ pending, allCards: catalog.cards, sets: catalog.sets, cacheDir, noCache: process.argv.includes('--no-cache') });
  const cats = (list) => {
    const m = {};
    for (const c of list) m[c.cat] = (m[c.cat] ?? 0) + 1;
    return JSON.stringify(m);
  };
  console.log(`\n${stats.marked} of ${stats.pending} cards without a TCGdex picture have one at Scrydex ${cats(pending.filter((c) => c.img))}; ${stats.byName} of them paired by name (numbering differs)`);
  const left = pending.filter((c) => !c.img);
  console.log(`${left.length} stay without ${cats(left)}: ${stats.noExpansion} in sets Scrydex does not list, ${stats.notListed} not listed in their expansion, ${stats.placeholder} listed without a picture`);
  const sets = {};
  for (const c of left) sets[c.set] = (sets[c.set] ?? 0) + 1;
  console.log('  by set:', JSON.stringify(sets));
  if (stats.mismatched.length) console.log(['same number, another name (left alone):', ...stats.mismatched].join('\n  '));
  console.log(`requests made: ${stats.requests}`);
}
