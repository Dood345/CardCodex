/**
 * `npm run deck-bench`: the full benchmark on this machine. It runs every
 * judge over the decks the engine builds (four seeds per type) and over every
 * corpus folder under scripts/.cache/decks (see local.ts), writes the tables
 * to scripts/.cache/deck-bench/report.md, and fails when a judge fell behind
 * baseline.json by more than the tolerance.
 *
 * `npm run deck-bench:update` records the current numbers as the baseline;
 * do that on purpose, after reading the report, and say why in the commit.
 * The baseline holds aggregate rates only, never a deck list.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { buildIndex } from '@/data/catalog';
import type { Catalog, SpeciesFile } from '@/data/types';
import type { SuggestOptions } from '../builder';
import { buildTextIndex, type CardTextFile } from '../card-text';
import { createPokemonEvaluator } from '../pokemon';
import { compareReports, formatReport, runBench, scoreJudges, type BenchReport, type Corpus } from './bench';
import { builtCorpus, pokemonSeeds } from './built';
import { readCorpora } from './local';

const root = new URL('../../../', import.meta.url);
const read = <T,>(f: string): T => JSON.parse(readFileSync(new URL(`public/data/${f}`, root), 'utf8')) as T;
const baselineFile = new URL('./baseline.json', import.meta.url);
const outDir = new URL('scripts/.cache/deck-bench/', root);
const update = process.env.npm_lifecycle_event === 'deck-bench:update';

it('deck benchmark', { timeout: 30 * 60_000 }, () => {
  const index = buildIndex(read<Catalog>('catalog.json'), read<SpeciesFile>('species.json').species);
  const ev = createPokemonEvaluator({ index, text: buildTextIndex(read<CardTextFile>('text.json')) });
  const judges = scoreJudges(ev);

  const options: SuggestOptions = { source: 'catalog', collection: new Map(), format: 'standard' };
  const pool = ev.pool(options);
  const corpora: Corpus[] = [builtCorpus(ev, pokemonSeeds(ev, pool, 4), options, pool)];
  const local = readCorpora(fileURLToPath(new URL('scripts/.cache/decks/', root)), index);
  corpora.push(...local);

  const reports: Record<string, BenchReport> = {};
  for (const corpus of corpora) reports[corpus.id] = runBench(ev, index, corpus, judges, { seed: 1, repeats: 5 });

  let baseline: Record<string, BenchReport> = {};
  try {
    baseline = JSON.parse(readFileSync(baselineFile, 'utf8')) as Record<string, BenchReport>;
  } catch {
    // No baseline yet: everything is new.
  }
  const regressions: string[] = [];
  const notes: string[] = [];
  for (const [id, report] of Object.entries(reports)) {
    if (baseline[id]) regressions.push(...compareReports(report, baseline[id]));
    else notes.push(`${id}: no baseline recorded yet`);
  }
  for (const id of Object.keys(baseline)) if (!reports[id]) notes.push(`${id}: in the baseline, not on this machine (corpus folder missing)`);
  for (const c of local) if (c.skipped) notes.push(`${c.id}: ${c.skipped} decks skipped (cards missing from the catalog)`);

  mkdirSync(outDir, { recursive: true });
  const text = [
    '# Deck benchmark',
    '',
    `Catalog built ${index.catalog.builtAt}. ${regressions.length ? `${regressions.length} regressions.` : 'No regressions.'}`,
    '',
    ...regressions.map((r) => `- REGRESSION ${r}`),
    ...notes.map((n) => `- ${n}`),
    '',
    ...Object.values(reports).map(formatReport),
  ].join('\n');
  writeFileSync(new URL('report.md', outDir), text);
  writeFileSync(new URL('report.json', outDir), JSON.stringify(reports, null, 1));

  if (update) {
    // Keep baselines of corpora this machine does not have.
    writeFileSync(baselineFile, `${JSON.stringify({ ...baseline, ...reports }, null, 1)}\n`);
    return;
  }
  expect(regressions, `see scripts/.cache/deck-bench/report.md`).toEqual([]);
});
