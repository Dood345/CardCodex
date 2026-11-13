/**
 * A headless Chrome driven over the DevTools protocol, with nothing installed: the Chrome already on the
 * machine (or $CHROME_PATH) and Node's own WebSocket. Each page lives in a browser context of its own, so
 * a test starts with empty storage and leaves nothing behind for the next.
 *
 * Why not a test framework's browser: the checks need a phone-sized page, IndexedDB and the dev server's
 * modules, which this gives in a hundred lines, and a framework would bring its own browser download.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The Chrome to run: $CHROME_PATH, else the usual install places on Windows, Linux and macOS. */
export function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) throw new Error('No Chrome found: install Chrome or set CHROME_PATH to a Chrome or Chromium binary.');
  return found;
}

/** Start Chrome and return `{ newPage, close }`. `viewport`: the phone the pages pretend to be. */
export async function launch({ viewport = { width: 412, height: 915, scale: 1.5 }, extraArgs = [] } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cardcodex-e2e-'));
  const proc = spawn(
    findChrome(),
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--mute-audio',
      // A CI container has no user namespace for Chrome's sandbox.
      ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
      `--user-data-dir=${profile}`,
      `--window-size=${viewport.width},${viewport.height}`,
      '--remote-debugging-port=0',
      ...extraArgs,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 300 && !fs.existsSync(portFile); i++) await sleep(100);
  if (!fs.existsSync(portFile)) {
    proc.kill();
    throw new Error('Chrome did not start (no DevToolsActivePort after 30 s).');
  }
  const [port, wsPath] = fs.readFileSync(portFile, 'utf8').trim().split('\n');
  const ws = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('Could not connect to Chrome.'));
  });

  let nextId = 0;
  const pending = new Map();
  /** sessionId → handler of that page's events. */
  const listeners = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject, method } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(`${method}: ${m.error.message}`));
      else resolve(m.result);
    } else if (m.sessionId && listeners.has(m.sessionId)) listeners.get(m.sessionId)(m);
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject, method });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

  async function newPage() {
    const { browserContextId } = await send('Target.createBrowserContext');
    const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const s = (method, params) => send(method, params, sessionId);
    /** Uncaught exceptions of the page: a test fails on any. */
    const errors = [];
    listeners.set(sessionId, (m) => {
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        errors.push((d.exception?.description ?? d.text ?? 'exception').split('\n').slice(0, 3).join(' ').slice(0, 400));
      }
    });
    await s('Page.enable');
    await s('Runtime.enable');
    await s('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.scale, mobile: true });

    /**
     * Run `fn` in the page with `args` (JSON values) and return what it returns. The function is sent as
     * source, so it sees the page and its own arguments and nothing of the test file around it.
     */
    async function run(fn, ...args) {
      const expression = `(${fn.toString()})(...${JSON.stringify(args)})`;
      const r = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) {
        const d = r.exceptionDetails;
        throw new Error(`in the page: ${(d.exception?.description ?? d.text ?? 'exception').slice(0, 600)}`);
      }
      return r.result.value;
    }

    /** Poll `fn` in the page until it returns something truthy; that value is returned. */
    async function waitFor(fn, { args = [], timeout = 20_000, what = 'the condition' } = {}) {
      const until = Date.now() + timeout;
      for (;;) {
        const v = await run(fn, ...args);
        if (v) return v;
        if (Date.now() > until) throw new Error(`timed out after ${timeout / 1000} s waiting for ${what}`);
        await sleep(150);
      }
    }

    return {
      errors,
      run,
      waitFor,
      async goto(url) {
        await s('Page.navigate', { url });
      },
      async screenshot(file) {
        const { data } = await s('Page.captureScreenshot', { format: 'png' });
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, Buffer.from(data, 'base64'));
      },
      async close() {
        listeners.delete(sessionId);
        await send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
      },
    };
  }

  return {
    newPage,
    async close() {
      try {
        ws.close();
      } catch {
        // already gone
      }
      proc.kill();
      await sleep(300);
      try {
        fs.rmSync(profile, { recursive: true, force: true });
      } catch {
        // Windows keeps the profile locked for a moment; the temp folder is cleaned by the system.
      }
    },
  };
}
