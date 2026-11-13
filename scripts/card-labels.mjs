/**
 * The labels printed on Pokémon cards that the card data does not carry: Single Strike, Rapid Strike and
 * Fusion Strike (Sword & Shield, from Battle Styles on), Ancient, Future and Tera (Scarlet & Violet on).
 * Card text refers to them ("your Future Pokémon", "a Single Strike Pokémon"), and TCGdex has no field for
 * any of them, so they are read off the card pictures by scripts/build-labels.mjs and kept in
 * scripts/card-labels.json, the record of what was read. This module applies that record to the card text
 * file (public/data/text.json, field `lb`), for build-labels.mjs and for build-text.mjs, which rebuilds
 * the text file from TCGdex and must not lose the labels.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CARD_LABELS_FILE = path.join(ROOT, 'scripts', 'card-labels.json');

/** The labels, in the order the files list them. */
export const LABELS = ['Single Strike', 'Rapid Strike', 'Fusion Strike', 'Ancient', 'Future', 'Tera'];

/** The record: { version, builtAt, labels: { [label]: card ids } }, or null when it was never built. */
export function readCardLabels(file = CARD_LABELS_FILE) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Put the labels into a card text file object (mutates it): `lb` maps each label to the ids, among the
 * file's own, that carry it. Ids the text file does not know are left out; returns how many were set.
 */
export function applyCardLabels(textFile, record = readCardLabels()) {
  delete textFile.lb;
  if (!record) return 0;
  const known = new Set(textFile.ids);
  const lb = {};
  let n = 0;
  for (const label of LABELS) {
    const ids = (record.labels[label] ?? []).filter((id) => known.has(id));
    if (!ids.length) continue;
    lb[label] = ids;
    n += ids.length;
  }
  if (n) textFile.lb = lb;
  return n;
}
