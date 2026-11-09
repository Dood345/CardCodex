#!/usr/bin/env node
// Builds public/data/ygo/text.json: the rules text of every Yu-Gi-Oh! card the
// catalog holds, for the deck recommender (src/recommend/ygo.ts). The catalog
// (public/data/ygo/catalog.json) already has name, type, frame, attribute,
// Monster Type, Level/Rank/Link rating, ATK/DEF and archetype; this file adds
// what it lacks: the effect text, an Extra Deck monster's materials line, the
// Pendulum Effect, and the card's status on the TCG Forbidden & Limited list.
//
// Source: the YGOPRODeck API v7 cardinfo download the catalog builder caches in
// scripts/.cache/ygo_cardinfo.json (https://ygoprodeck.com/api-guide/). This
// script never downloads anything: run `npm run catalog:ygo` first. Data may be
// bundled under YGOPRODeck's terms; images are not involved here.
//
// Node built-ins only. Usage: node scripts/build-ygo-text.mjs
//
// Shape (see src/recommend/ygo-text.ts): parallel arrays over the cards that
// have text, keyed by passcode (printings share a card's text):
//   pc  passcode
//   fx  effect text: the monster effect without its materials line, or the
//       Spell/Trap text. Normal Monsters carry flavour text, which is left out.
//   mt  materials line of a Fusion, Synchro, Xyz or Link monster ("" otherwise,
//       and "" when the first line is an effect, as on "Mask Change" Fusions)
//   pe  Pendulum Effect ("" when none)
// and `ban`, passcode → TCG status: 0 Forbidden, 1 Limited, 2 Semi-Limited
// (cards absent are Unlimited), from the API's banlist_info.ban_tcg.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { writeDataManifest } from './data-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'scripts', '.cache', 'ygo_cardinfo.json');
const CATALOG = path.join(ROOT, 'public', 'data', 'ygo', 'catalog.json');
const OUT = path.join(ROOT, 'public', 'data', 'ygo', 'text.json');

const log = (...a) => console.log(...a);
const fail = (msg) => {
  console.error('\nVALIDATION FAILED: ' + msg);
  process.exit(1);
};
const assert = (cond, msg) => {
  if (!cond) fail(msg);
};

assert(fs.existsSync(CACHE), `${path.relative(ROOT, CACHE)} is missing: run npm run catalog:ygo first`);
assert(fs.existsSync(CATALOG), `${path.relative(ROOT, CATALOG)} is missing: run npm run catalog:ygo first`);

const raw = JSON.parse(fs.readFileSync(CACHE, 'utf8')).data;
const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
assert(Array.isArray(raw) && raw.length > 10000, `too few cards in the cache: ${raw?.length}`);
const cachedAt = fs.statSync(CACHE).mtime.toISOString();
log(`Yu-Gi-Oh! card text (YGOPRODeck cache of ${cachedAt.slice(0, 10)}): ${raw.length} cards`);

/** Passcodes the catalog knows; skills and tokens never go in a deck. */
const wanted = new Set(catalog.cards.filter((c) => !/^(?:skill|token)$/.test(c.frame)).map((c) => c.pc));

const EXTRA = /^(?:fusion|synchro|xyz|link)(?:_pendulum)?$/;
/** A materials line names monsters and nothing else: no sentence verbs, no colon or semicolon. */
const MATERIAL_LINE = /\bmonsters?\b|\bTuners?\b|"[^"]+"\s*\+|^\d+ x "|^\d+\+? Level \d+ "/i;
const NOT_MATERIALS = /[:;]|\b(?:Must|Cannot|You can|If|When|Once per)\b/;

const clean = (s) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim();

const pcs = [];
const fx = [];
const mt = [];
const pe = [];
const ban = {};
const BAN = { Forbidden: 0, Limited: 1, 'Semi-Limited': 2 };
let noMaterials = 0;
let normals = 0;
for (const c of [...raw].sort((a, b) => a.id - b.id)) {
  if (!wanted.has(c.id)) continue;
  const status = c.banlist_info?.ban_tcg;
  if (status !== undefined) {
    assert(status in BAN, `unknown TCG status "${status}" on ${c.name}`);
    ban[c.id] = BAN[status];
  }
  const pend = /pendulum/.test(c.frameType);
  // Pendulum monsters carry both texts joined under "[ Pendulum Effect ]" / "[ Monster Effect ]" headers; the API also splits them.
  let monster = clean(pend ? (c.monster_desc ?? c.desc.split('[ Monster Effect ]')[1] ?? c.desc) : c.desc);
  const pendText = pend ? clean(c.pend_desc) : '';
  const normal = c.frameType === 'normal' || c.frameType === 'normal_pendulum';
  if (normal) {
    // Flavour text, not rules: a Normal Monster has no effect to read (an effectless Ritual Monster keeps its text, which names its Ritual Spell).
    normals++;
    monster = '';
  }
  let materials = '';
  if (EXTRA.test(c.frameType)) {
    // Usually the first line; a few older texts put " / " between the materials and the effect instead.
    // A leading parenthetical ("(This card's original Level is always treated as 12.)") comes before the materials.
    const lines = monster.split('\n');
    const lead = /^\(.*\)$/.test(lines[0] ?? '') && lines.length > 1 ? [lines.shift()] : [];
    const [line, ...rest] = lines;
    const [first, ...after] = line.split(' / ');
    if (MATERIAL_LINE.test(first) && !NOT_MATERIALS.test(first)) {
      materials = first.trim();
      monster = [...lead, after.join(' / '), ...rest].filter(Boolean).join('\n').trim();
    } else noMaterials++;
  }
  if (!monster && !materials && !pendText) continue;
  pcs.push(c.id);
  fx.push(monster);
  mt.push(materials);
  pe.push(pendText);
}

// ---------- validate ----------
const have = new Set(pcs);
const missing = [...wanted].filter((pc) => !have.has(pc));
assert(pcs.length > 10000, `too few cards with text: ${pcs.length}`);
assert(Object.keys(ban).length > 100, `too few TCG banlist entries: ${Object.keys(ban).length}`);
const extraCount = catalog.cards.filter((c) => EXTRA.test(c.frame)).length;
const withMaterials = mt.filter(Boolean).length;
assert(withMaterials > 0.95 * extraCount, `materials found on ${withMaterials} of ${extraCount} Extra Deck monsters`);

const out = {
  version: 1,
  game: 'ygo',
  builtAt: new Date().toISOString(),
  source: { name: 'YGOPRODeck API v7 cardinfo.php', url: 'https://db.ygoprodeck.com/api/v7/cardinfo.php', fetchedAt: cachedAt },
  pc: pcs,
  fx,
  mt,
  pe,
  ban,
};
const json = JSON.stringify(out);
const bytes = Buffer.byteLength(json);
fs.writeFileSync(OUT, json);
const gz = zlib.gzipSync(Buffer.from(json)).length;
log(`  ${pcs.length} cards with text; ${missing.length} catalog cards without (${normals} Normal Monsters' flavour text left out)`);
log(`  materials on ${withMaterials} of ${extraCount} Extra Deck monsters (${noMaterials} without a materials line)`);
log(`  TCG list: ${Object.values(ban).filter((v) => v === 0).length} Forbidden, ${Object.values(ban).filter((v) => v === 1).length} Limited, ${Object.values(ban).filter((v) => v === 2).length} Semi-Limited`);
log(`Wrote ${path.relative(ROOT, OUT)} (${(bytes / 1e6).toFixed(2)} MB, ${(gz / 1e6).toFixed(2)} MB gzipped)`);
writeDataManifest();
