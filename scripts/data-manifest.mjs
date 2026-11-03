#!/usr/bin/env node
// Writes public/data/manifest.json: the content hash, byte size and builtAt of
// every data file the app loads (the catalogs and the artwork hash table). The
// catalog builders and build-hashes.mjs call writeDataManifest() after writing; run this file on its own to regenerate the manifest
// from whatever is in public/data (for example after restoring a catalog with git).
//
// Why: the deployed web app fetches the multi-megabyte catalogs with
// `cache: 'force-cache'` so an unchanged catalog is never downloaded twice. The
// browser can only tell "unchanged" apart from "new sets" if the URL changes, so
// the app first fetches this small manifest with `cache: 'no-cache'` (one
// conditional request) and then asks for `catalog.json?v=<hash>`: a new hash is a
// new URL, which misses every cache (browser, service worker, CDN) exactly once.
// The hash is derived from the file itself, so the manifest can always be
// regenerated and never drifts from the data. See src/data/manifest.ts.
//
// Usage: node scripts/data-manifest.mjs [--check]   (--check: exit 1 if stale, write nothing)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'public', 'data');
export const MANIFEST = path.join(DATA_DIR, 'manifest.json');

/** Data files relative to public/data, in the order they are listed. */
export const DATA_FILES = ['catalog.json', 'species.json', 'ygo/catalog.json', 'mtg/catalog.json', 'hashes.json', 'ygo/hashes.json', 'ygo/decks.json'];

/** Manifest schema version (the app ignores manifests it does not understand). */
export const MANIFEST_VERSION = 1;

/** Version key of a data file: the first 12 hex digits of its SHA-256. */
export function hashOf(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 12);
}

/** Builds the manifest object from the files on disk (throws if one is missing). */
export function buildDataManifest(dataDir = DATA_DIR) {
  const files = {};
  for (const rel of DATA_FILES) {
    const p = path.join(dataDir, rel);
    if (!fs.existsSync(p)) throw new Error(`missing data file ${path.relative(ROOT, p)}`);
    const buf = fs.readFileSync(p);
    const entry = { hash: hashOf(buf), bytes: buf.length };
    const builtAt = JSON.parse(buf.toString('utf8')).builtAt;
    if (typeof builtAt === 'string') entry.builtAt = builtAt;
    files[rel] = entry;
  }
  // No timestamp of its own: the manifest is a pure function of the files, so a
  // regeneration without data changes produces no diff.
  return { version: MANIFEST_VERSION, files };
}

export function manifestJson(manifest) {
  return JSON.stringify(manifest, null, 2) + '\n';
}

/** Writes public/data/manifest.json; returns the manifest. */
export function writeDataManifest(dataDir = DATA_DIR) {
  const manifest = buildDataManifest(dataDir);
  fs.writeFileSync(path.join(dataDir, 'manifest.json'), manifestJson(manifest));
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const manifest = buildDataManifest();
  const json = manifestJson(manifest);
  const rel = path.relative(ROOT, MANIFEST);
  if (check) {
    const current = fs.existsSync(MANIFEST) ? fs.readFileSync(MANIFEST, 'utf8') : '';
    if (current === json) {
      console.log(`${rel} matches public/data`);
    } else {
      console.error(`${rel} is stale: run \`node scripts/data-manifest.mjs\``);
      process.exit(1);
    }
  } else {
    fs.writeFileSync(MANIFEST, json);
    console.log(`Wrote ${rel}`);
  }
  for (const [file, e] of Object.entries(manifest.files)) console.log(`  ${file}: v=${e.hash} ${e.bytes} bytes${e.builtAt ? ` built ${e.builtAt}` : ''}`);
}
