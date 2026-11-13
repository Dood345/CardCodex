#!/usr/bin/env node
/**
 * Browser checks of the app, end to end, in a headless Chrome at phone size.
 *
 *   npm run e2e                 # all checks
 *   npm run e2e -- decks        # only the checks whose name contains "decks" (file or test name)
 *   E2E_BASE=http://localhost:5173 npm run e2e   # against a dev server that is already running
 *
 * Each file under e2e/ named *.e2e.mjs exports a list of `{ name, run({ page, base }) }`. A check gets a
 * fresh browser context (empty storage), fails on a thrown assertion or on any uncaught exception in the
 * page, and leaves a screenshot under e2e/.out/ when it fails. Exit code 1 if any check failed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startApp } from './lib/app.mjs';
import { launch } from './lib/browser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '.out');
const filter = process.argv.slice(2).find((a) => !a.startsWith('-'))?.toLowerCase();

const files = fs.readdirSync(HERE).filter((f) => f.endsWith('.e2e.mjs')).sort();
const checks = [];
for (const file of files) {
  const mod = await import(pathToFileURL(path.join(HERE, file)).href);
  for (const check of mod.default) checks.push({ ...check, file, name: `${file.replace('.e2e.mjs', '')}: ${check.name}` });
}
const chosen = filter ? checks.filter((c) => c.name.toLowerCase().includes(filter)) : checks;
if (!chosen.length) {
  console.error(`no check matches "${filter}" (${checks.length} checks in ${files.join(', ')})`);
  process.exit(1);
}

const app = await startApp();
const browser = await launch();
fs.rmSync(OUT, { recursive: true, force: true });
const failed = [];
const t0 = Date.now();
console.log(`${chosen.length} browser checks against ${app.base}\n`);
for (const check of chosen) {
  const page = await browser.newPage();
  const started = Date.now();
  let error = null;
  try {
    await check.run({ page, base: app.base });
    if (page.errors.length) throw new Error(`uncaught in the page: ${page.errors.join(' | ')}`);
  } catch (e) {
    error = e;
    const shot = path.join(OUT, `${check.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`);
    await page.screenshot(shot).catch(() => {});
    failed.push({ name: check.name, message: String(e?.message ?? e), shot });
  }
  await page.close();
  console.log(`${error ? 'FAIL' : ' ok '}  ${check.name}  (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  if (error) console.log(`      ${String(error.message ?? error).split('\n').join('\n      ')}`);
}
await browser.close();
await app.stop();

console.log(`\n${chosen.length - failed.length} passed, ${failed.length} failed, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
for (const f of failed) console.log(`  ${f.name}\n    screenshot: ${path.relative(process.cwd(), f.shot)}`);
process.exit(failed.length ? 1 : 0);
