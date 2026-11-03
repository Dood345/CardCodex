import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  dataCacheMode,
  dataFileUrl,
  parseManifest,
  resolveManifest,
  usesManifest,
  versionMismatch,
  versionOf,
  type DataManifest,
} from './manifest';

const manifest: DataManifest = {
  version: 1,
  files: {
    'catalog.json': { hash: 'abc123def456', bytes: 10, builtAt: '2026-01-01T00:00:00Z' },
    'ygo/catalog.json': { hash: '0123456789ab', bytes: 20 },
  },
};

describe('parseManifest', () => {
  it('accepts what scripts/data-manifest.mjs writes', () => {
    expect(parseManifest(JSON.parse(JSON.stringify(manifest)))).toEqual(manifest);
  });
  it('rejects anything it cannot use', () => {
    expect(parseManifest(null)).toBeNull();
    expect(parseManifest('x')).toBeNull();
    expect(parseManifest({ version: 2, files: {} })).toBeNull();
    expect(parseManifest({ version: 1 })).toBeNull();
    expect(parseManifest({ version: 1, files: { 'a.json': { hash: 'not hex!', bytes: 1 } } })).toBeNull();
    expect(parseManifest({ version: 1, files: { 'a.json': { hash: 'abcdef', bytes: -1 } } })).toBeNull();
    expect(parseManifest({ version: 1, files: { 'a.json': null } })).toBeNull();
  });
  it('drops a builtAt that is not a string', () => {
    expect(parseManifest({ version: 1, files: { 'a.json': { hash: 'abcdef', bytes: 1, builtAt: 5 } } })).toEqual({
      version: 1,
      files: { 'a.json': { hash: 'abcdef', bytes: 1 } },
    });
  });
});

describe('versionOf / dataFileUrl', () => {
  it('reads the hash per file and leaves unknown files unversioned', () => {
    expect(versionOf(manifest, 'catalog.json')).toBe('abc123def456');
    expect(versionOf(manifest, 'species.json')).toBeUndefined();
    expect(versionOf(null, 'catalog.json')).toBeUndefined();
  });
  it('builds the URL with ?v= only when a version is known', () => {
    expect(dataFileUrl('/data', 'catalog.json', 'abc123')).toBe('/data/catalog.json?v=abc123');
    expect(dataFileUrl('/data/', '/ygo/catalog.json', 'abc123')).toBe('/data/ygo/catalog.json?v=abc123');
    expect(dataFileUrl('/repo/data', 'catalog.json')).toBe('/repo/data/catalog.json');
    expect(dataFileUrl('/data', 'catalog.json', 'a b')).toBe('/data/catalog.json?v=a%20b');
  });
});

describe('fetch policy', () => {
  it('dev revalidates plain URLs and never reads the manifest', () => {
    expect(usesManifest({ dev: true, native: false })).toBe(false);
    expect(dataCacheMode({ dev: true, native: false, versioned: false })).toBe('no-cache');
    expect(dataCacheMode({ dev: true, native: false, versioned: true })).toBe('no-cache');
  });
  it('android reads bundled assets from cache without a manifest', () => {
    expect(usesManifest({ dev: false, native: true })).toBe(false);
    expect(dataCacheMode({ dev: false, native: true, versioned: false })).toBe('force-cache');
  });
  it('the web build caches versioned URLs forever and defers otherwise to HTTP headers', () => {
    expect(usesManifest({ dev: false, native: false })).toBe(true);
    expect(dataCacheMode({ dev: false, native: false, versioned: true })).toBe('force-cache');
    expect(dataCacheMode({ dev: false, native: false, versioned: false })).toBe('default');
  });
});

describe('resolveManifest', () => {
  const fresh: DataManifest = { version: 1, files: { 'catalog.json': { hash: 'ffffffffffff', bytes: 1 } } };
  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
  const timers = () => {
    const fns: (() => void)[] = [];
    return { fire: () => fns.splice(0).forEach((f) => f()), setTimeoutFn: (fn: () => void) => fns.push(fn) };
  };

  it('a first start waits for the live manifest and remembers it', async () => {
    const live = deferred<DataManifest | null>();
    const remembered: DataManifest[] = [];
    const t = timers();
    const p = resolveManifest({ fetchFresh: () => live.promise, remembered: null, remember: (m) => remembered.push(m), setTimeoutFn: t.setTimeoutFn });
    t.fire(); // a timeout must not cut a first start short: there is nothing cached to show
    live.resolve(fresh);
    expect(await p).toEqual(fresh);
    expect(remembered).toEqual([fresh]);
  });
  it('a first start offline resolves null', async () => {
    const remembered: DataManifest[] = [];
    const result = await resolveManifest({ fetchFresh: () => Promise.reject(new Error('offline')), remembered: null, remember: (m) => remembered.push(m) });
    expect(result).toBeNull();
    expect(remembered).toEqual([]);
  });
  it('a returning user gets the live manifest when it arrives in time', async () => {
    const t = timers();
    const result = await resolveManifest({ fetchFresh: async () => fresh, remembered: manifest, remember: () => {}, setTimeoutFn: t.setTimeoutFn });
    expect(result).toEqual(fresh);
  });
  it('a returning user falls back to the remembered manifest on timeout, and the late one is kept for next time', async () => {
    const live = deferred<DataManifest | null>();
    const remembered: DataManifest[] = [];
    const t = timers();
    const p = resolveManifest({ fetchFresh: () => live.promise, remembered: manifest, remember: (m) => remembered.push(m), setTimeoutFn: t.setTimeoutFn });
    t.fire();
    expect(await p).toEqual(manifest);
    expect(remembered).toEqual([]);
    live.resolve(fresh);
    await live.promise;
    await Promise.resolve();
    expect(remembered).toEqual([fresh]);
  });
  it('a returning user offline keeps the remembered manifest', async () => {
    const t = timers();
    const result = await resolveManifest({ fetchFresh: () => Promise.reject(new Error('offline')), remembered: manifest, remember: () => {}, setTimeoutFn: t.setTimeoutFn });
    expect(result).toEqual(manifest);
    const unusable = await resolveManifest({ fetchFresh: async () => null, remembered: manifest, remember: () => {}, setTimeoutFn: t.setTimeoutFn });
    expect(unusable).toEqual(manifest);
  });
});

describe('versionMismatch', () => {
  it('flags a file whose builtAt differs from the manifest, and nothing else', () => {
    expect(versionMismatch(manifest, 'catalog.json', { builtAt: '2026-01-01T00:00:00Z' })).toBe(false);
    expect(versionMismatch(manifest, 'catalog.json', { builtAt: '2027-01-01T00:00:00Z' })).toBe(true);
    expect(versionMismatch(manifest, 'ygo/catalog.json', { builtAt: '2027-01-01T00:00:00Z' })).toBe(false);
    expect(versionMismatch(null, 'catalog.json', { builtAt: '2027-01-01T00:00:00Z' })).toBe(false);
  });
});

describe('public/data/manifest.json', () => {
  // The guard for "rebuilt (or restored) a catalog without regenerating the
  // manifest": `node scripts/data-manifest.mjs` fixes it. The hash formula is
  // the writer's contract: first 12 hex digits of the file's SHA-256.
  const dataDir = new URL('../../public/data/', import.meta.url);
  const committed = parseManifest(JSON.parse(readFileSync(new URL('manifest.json', dataDir), 'utf8')));

  it('lists every data file the app loads', () => {
    expect(committed).not.toBeNull();
    expect(Object.keys(committed!.files).sort()).toEqual(['catalog.json', 'hashes.json', 'mtg/catalog.json', 'species.json', 'ygo/catalog.json', 'ygo/decks.json', 'ygo/hashes.json']);
  });
  it('matches the committed data files byte for byte', () => {
    for (const [file, entry] of Object.entries(committed!.files)) {
      const buf = readFileSync(new URL(file, dataDir));
      expect(entry.bytes, file).toBe(buf.length);
      expect(entry.hash, file).toBe(createHash('sha256').update(buf).digest('hex').slice(0, 12));
      expect(entry.builtAt, file).toBe((JSON.parse(buf.toString('utf8')) as { builtAt: string }).builtAt);
    }
  });
});
