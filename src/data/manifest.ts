/**
 * Catalog versions for the web build's cache busting.
 *
 * public/data/manifest.json (written by scripts/data-manifest.mjs, by both
 * catalog builders) lists a content hash per data file. The deployed web app
 * fetches that small file with `cache: 'no-cache'` on every start (one
 * conditional request, a 304 when nothing changed) and then requests each
 * catalog as `catalog.json?v=<hash>` with `cache: 'force-cache'`:
 *
 *  - unchanged catalog → same URL → served from the HTTP cache (or the service
 *    worker's data cache) without a download;
 *  - rebuilt catalog → new hash → new URL → one download, and every cache in the
 *    path (browser, service worker, the host's CDN) misses exactly once.
 *
 * The last manifest seen is remembered in localStorage so a returning user is
 * not held up by a slow or hanging manifest request (the cached catalog loads
 * after a short timeout) and so the app still knows which version it has when
 * offline. Everything here is pure and injectable so it can be unit-tested;
 * src/data/catalog.ts wires it to fetch, localStorage and the platform checks.
 */

export interface DataFileVersion {
  /** First 12 hex digits of the file's SHA-256 (scripts/data-manifest.mjs). */
  hash: string;
  bytes: number;
  /** The file's own `builtAt`, for display and sanity checks. */
  builtAt?: string;
}

export interface DataManifest {
  version: number;
  /** Keyed by path relative to public/data: "catalog.json", "ygo/catalog.json". */
  files: Record<string, DataFileVersion>;
}

/** The manifest schema this app understands. */
export const MANIFEST_VERSION = 1;

/** How long a returning user waits for the manifest before the remembered version is used. */
export const MANIFEST_TIMEOUT_MS = 2000;

const HASH_RE = /^[0-9a-f]{6,64}$/;

/** Validates a parsed manifest.json; null for anything the app cannot use. */
export function parseManifest(json: unknown): DataManifest | null {
  if (!json || typeof json !== 'object') return null;
  const { version, files } = json as { version?: unknown; files?: unknown };
  if (version !== MANIFEST_VERSION || !files || typeof files !== 'object') return null;
  const out: Record<string, DataFileVersion> = {};
  for (const [file, entry] of Object.entries(files as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') return null;
    const { hash, bytes, builtAt } = entry as { hash?: unknown; bytes?: unknown; builtAt?: unknown };
    if (typeof hash !== 'string' || !HASH_RE.test(hash)) return null;
    if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null;
    out[file] = { hash, bytes, ...(typeof builtAt === 'string' ? { builtAt } : {}) };
  }
  return { version: MANIFEST_VERSION, files: out };
}

/** Version key for a data file, or undefined when the manifest does not list it. */
export function versionOf(manifest: DataManifest | null | undefined, file: string): string | undefined {
  return manifest?.files[file]?.hash;
}

/** `${base}/${file}` plus `?v=<version>` when a version is known. */
export function dataFileUrl(base: string, file: string, version?: string): string {
  const url = `${base.replace(/\/+$/, '')}/${file.replace(/^\/+/, '')}`;
  return version ? `${url}?v=${encodeURIComponent(version)}` : url;
}

export interface FetchPolicyInput {
  /** `import.meta.env.DEV`: rebuilt files must show up on the next reload. */
  dev: boolean;
  /** Inside the Capacitor shell: the files are bundled assets, versioning is moot. */
  native: boolean;
  /** Whether the request carries a version in its URL. */
  versioned: boolean;
}

/**
 * Cache mode for a catalog request. Dev always revalidates; a versioned URL (or a
 * bundled asset, which changes only with the APK) may be served from cache
 * indefinitely; a web request without a version leaves it to the HTTP headers.
 */
export function dataCacheMode({ dev, native, versioned }: FetchPolicyInput): RequestCache {
  if (dev) return 'no-cache';
  if (versioned || native) return 'force-cache';
  return 'default';
}

/** Whether this build should consult the manifest at all. */
export function usesManifest({ dev, native }: Pick<FetchPolicyInput, 'dev' | 'native'>): boolean {
  return !dev && !native;
}

export interface ResolveManifestOptions {
  /** Fetches and parses the live manifest; resolves null on any failure (offline, 404, bad JSON). */
  fetchFresh: () => Promise<DataManifest | null>;
  /** The manifest remembered from the previous start, if any. */
  remembered: DataManifest | null;
  /** Persists a freshly fetched manifest for the next start. */
  remember: (manifest: DataManifest) => void;
  /** Wait this long for the live manifest when a remembered one exists. */
  timeoutMs?: number;
  /** Injectable timer for tests. */
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
}

const TIMED_OUT = Symbol('timed out');

/**
 * Picks the manifest to load the catalog with.
 *
 * A first-time user has nothing cached, so the live manifest is awaited for as
 * long as it takes (there is no faster path). A returning user waits at most
 * `timeoutMs`; after that the remembered manifest is used so the cached catalog
 * appears at once, while the live request keeps running and, when it finally
 * arrives, is remembered for the next start. A failed live request falls back to
 * the remembered manifest (offline) or null (nothing known: unversioned URLs).
 */
export async function resolveManifest({
  fetchFresh,
  remembered,
  remember,
  timeoutMs = MANIFEST_TIMEOUT_MS,
  setTimeoutFn = (fn, ms) => setTimeout(fn, ms),
}: ResolveManifestOptions): Promise<DataManifest | null> {
  const fresh = fetchFresh()
    .then((m) => {
      if (m) remember(m);
      return m;
    })
    .catch(() => null);
  if (!remembered) return fresh;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => setTimeoutFn(() => resolve(TIMED_OUT), timeoutMs));
  const result = await Promise.race([fresh, timeout]);
  if (result === TIMED_OUT || result === null) return remembered;
  return result;
}

/** True when the file the manifest promises differs from the one that was loaded. */
export function versionMismatch(manifest: DataManifest | null, file: string, loaded: { builtAt?: string }): boolean {
  const expected = manifest?.files[file]?.builtAt;
  return !!expected && !!loaded.builtAt && expected !== loaded.builtAt;
}
