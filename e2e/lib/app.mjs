/**
 * What every browser check needs of the app: the dev server (the tests seed data through the app's own
 * modules, which only the dev server serves), and a page opened on a game with the first-run tour off.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * The app's address and a way to stop it: $E2E_BASE (a dev server already running, say
 * http://localhost:5173) or a Vite dev server started here on a free port.
 */
export async function startApp() {
  if (process.env.E2E_BASE) return { base: process.env.E2E_BASE.replace(/\/$/, ''), stop: async () => {} };
  const { createServer } = await import('vite');
  const server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 5183, strictPort: false, host: '127.0.0.1' } });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  return { base, stop: () => server.close() };
}

/** Open the app on `game` at `hash` ("#/sets"), tour done, and wait until its first screen is there. */
export async function openApp(page, base, game, hash = '#/sets') {
  await page.goto(`${base}/#/sets`);
  await page.waitFor(() => document.readyState === 'complete' && !!window.localStorage, { what: 'the page to load' });
  await page.run(
    (g, h) => {
      const s = JSON.parse(localStorage.getItem('cardcodex.settings') || '{}');
      s.tourDone = true;
      s.game = g;
      localStorage.setItem('cardcodex.settings', JSON.stringify(s));
      location.hash = h;
      location.reload();
    },
    game,
    hash,
  );
  // The Magic catalog is 11 MB: give the first load room.
  await page.waitFor(() => !!document.querySelector('#main') && !document.querySelector('.boot, .loading-screen') && document.querySelector('#main').innerText.length > 20, {
    timeout: 60_000,
    what: `the ${game} app to show its first screen`,
  });
}

/** True when the page scrolls sideways: a layout that does not fit a phone. */
export const overflowsSideways = () => document.documentElement.scrollWidth > document.documentElement.clientWidth;

/** Click the first button or link whose text is exactly `label`; false when there is none. */
export const clickByText = (label, within = 'body') => {
  const root = document.querySelector(within);
  const el = root && [...root.querySelectorAll('button, a, [role=tab]')].find((b) => b.textContent.trim() === label);
  if (!el) return false;
  el.click();
  return true;
};
