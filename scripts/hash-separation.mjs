#!/usr/bin/env node
/**
 * How well a hash table separates its own entries: for every entry, the Hamming distance to its
 * nearest and second-nearest other entry (the whole table, brute force), the distribution of those
 * distances, and the entries that collide within the scanner's match limit (24 bits: pictures the
 * scanner cannot tell apart — reprints of one picture for Pokémon, reused or near-identical art for
 * Yu-Gi-Oh!). Pure Node, no browser.
 *
 *   node scripts/hash-separation.mjs                 # public/data/hashes.json (Pokémon)
 *   node scripts/hash-separation.mjs --game ygo      # public/data/ygo/hashes.json
 *   options: --limit 24 (collision limit, bits)  --show 30 (collisions listed)  --json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  if (i === -1) return def;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const game = opt('--game', 'pokemon');
const LIMIT = Number(opt('--limit', '24'));
const SHOW = Number(opt('--show', '30'));
const jsonOnly = args.includes('--json');
if (args.includes('--help') || args.includes('-h')) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*\n|^ \* ?/gm, ''));
  process.exit(0);
}
const dataDir = path.join(root, 'public', 'data', game === 'ygo' ? 'ygo' : '');
const file = JSON.parse(fs.readFileSync(path.join(dataDir, 'hashes.json'), 'utf8'));
const catalog = JSON.parse(fs.readFileSync(path.join(dataDir, 'catalog.json'), 'utf8'));

const vite = await createServer({ configFile: false, root, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false }, resolve: { alias: { '@': path.join(root, 'src') } } });
const { decodeHashFile, popcount32, HASH_WORDS, HASH_BITS } = await vite.ssrLoadModule(path.join(root, 'src/scanner/hash.ts'));
await vite.close();
const table = decodeHashFile(file);
const n = table.ids.length;
const { words } = table;

// Names per table id: Pokémon card ids; Yu-Gi-Oh! passcodes (alternate arts → the card's name).
const nameOf = new Map();
if (game === 'ygo') {
  for (const c of catalog.cards) {
    nameOf.set(String(c.pc), c.name);
    for (const a of c.alt ?? []) nameOf.set(String(a), `${c.name} (alt art)`);
  }
} else {
  for (const c of catalog.cards) nameOf.set(c.id, `${c.name} · ${c.set}`);
}

const t0 = Date.now();
const nearest = new Uint8Array(n).fill(HASH_BITS);
const second = new Uint8Array(n).fill(HASH_BITS);
const nearestIdx = new Int32Array(n).fill(-1);
const collisions = []; // [i, j, d] with d ≤ LIMIT, i < j
for (let i = 0; i < n; i++) {
  const o = i * HASH_WORDS;
  const a0 = words[o];
  const a1 = words[o + 1];
  const a2 = words[o + 2];
  const a3 = words[o + 3];
  for (let j = i + 1; j < n; j++) {
    const p = j * HASH_WORDS;
    const d = popcount32((words[p] ^ a0) >>> 0) + popcount32((words[p + 1] ^ a1) >>> 0) + popcount32((words[p + 2] ^ a2) >>> 0) + popcount32((words[p + 3] ^ a3) >>> 0);
    if (d < nearest[i]) {
      second[i] = nearest[i];
      nearest[i] = d;
      nearestIdx[i] = j;
    } else if (d < second[i]) second[i] = d;
    if (d < nearest[j]) {
      second[j] = nearest[j];
      nearest[j] = d;
      nearestIdx[j] = i;
    } else if (d < second[j]) second[j] = d;
    if (d <= LIMIT) collisions.push([i, j, d]);
  }
}
const ms = Date.now() - t0;

const sorted = (arr) => Array.from(arr).sort((a, b) => a - b);
const pct = (arr, q) => arr[Math.min(arr.length - 1, Math.floor(q * arr.length))];
const near = sorted(nearest);
const sec = sorted(second);
const hist = new Map();
for (const d of nearest) hist.set(d, (hist.get(d) ?? 0) + 1);
const cumulative = (limit) => Array.from(nearest).filter((d) => d <= limit).length;
const collidingIds = new Set();
for (const [i, j] of collisions) {
  collidingIds.add(i);
  collidingIds.add(j);
}
// Same-name collisions are expected (reprints / alternate arts); different names are the ones to worry about.
const sameName = collisions.filter(([i, j]) => nameOf.get(table.ids[i]) === nameOf.get(table.ids[j])).length;
const baseName = (id) => (nameOf.get(id) ?? '').replace(/ \(alt art\)$| · .*$/, '');
const sameCard = collisions.filter(([i, j]) => baseName(table.ids[i]) === baseName(table.ids[j])).length;

const summary = {
  game,
  spec: file.spec,
  entries: n,
  ms,
  nearest: { min: near[0], p10: pct(near, 0.1), median: pct(near, 0.5), p90: pct(near, 0.9), max: near[n - 1], mean: Math.round((near.reduce((s, d) => s + d, 0) / n) * 10) / 10 },
  second: { min: sec[0], median: pct(sec, 0.5), mean: Math.round((sec.reduce((s, d) => s + d, 0) / n) * 10) / 10 },
  within: Object.fromEntries([8, 12, 16, 20, 24, 28, 32].map((l) => [l, cumulative(l)])),
  collisions: { limit: LIMIT, pairs: collisions.length, entries: collidingIds.size, sameNamePairs: sameName, sameCardPairs: sameCard },
};
if (jsonOnly) {
  console.log(JSON.stringify({ ...summary, pairs: collisions.map(([i, j, d]) => [table.ids[i], table.ids[j], d]) }, null, 2));
  process.exit(0);
}
console.log(`${game}: ${n} entries (${file.spec}), all pairs in ${ms} ms`);
console.log(`nearest other entry:  min ${summary.nearest.min}  p10 ${summary.nearest.p10}  median ${summary.nearest.median}  p90 ${summary.nearest.p90}  max ${summary.nearest.max}  mean ${summary.nearest.mean} bits`);
console.log(`second nearest:       min ${summary.second.min}  median ${summary.second.median}  mean ${summary.second.mean} bits`);
console.log('entries whose nearest neighbour is within:  ' + Object.entries(summary.within).map(([l, c]) => `≤${l}: ${c} (${((100 * c) / n).toFixed(1)} %)`).join('  '));
console.log(`collisions within ${LIMIT} bits: ${collisions.length} pairs over ${collidingIds.size} entries; ${sameName} pairs share a name, ${sameCard} the card (reprint / alternate art)`);
console.log('\nnearest-neighbour histogram (bits: entries):');
const line = [];
for (let d = 0; d <= 40; d++) line.push(`${d}:${hist.get(d) ?? 0}`);
console.log('  ' + line.join('  '));
collisions.sort((a, b) => a[2] - b[2]);
console.log(`\nclosest ${Math.min(SHOW, collisions.length)} collisions (bits · id · id · names):`);
for (const [i, j, d] of collisions.slice(0, SHOW)) {
  console.log(`  ${String(d).padStart(2)}  ${table.ids[i].padEnd(13)} ${table.ids[j].padEnd(13)} ${nameOf.get(table.ids[i]) ?? '?'}  |  ${nameOf.get(table.ids[j]) ?? '?'}`);
}
const differentName = collisions.filter(([i, j]) => baseName(table.ids[i]) !== baseName(table.ids[j]));
if (differentName.length) {
  console.log(`\nclosest ${Math.min(SHOW, differentName.length)} collisions between different cards:`);
  for (const [i, j, d] of differentName.slice(0, SHOW)) {
    console.log(`  ${String(d).padStart(2)}  ${table.ids[i].padEnd(13)} ${table.ids[j].padEnd(13)} ${nameOf.get(table.ids[i]) ?? '?'}  |  ${nameOf.get(table.ids[j]) ?? '?'}`);
  }
}
