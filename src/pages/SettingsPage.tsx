import { useEffect, useRef, useState } from 'react';
import { saveFile, savedMessage } from '@/app/saveFile';
import { useCatalog, useGame } from '@/app/context';
import { useSettings, type Theme, type TileSize } from '@/app/settings';
import { openTour } from '@/app/tourState';
import { PAGE_LAYOUTS } from '@/scanner/page';
import { clearCollection, exportCollection, importCollection } from '@/data/collection';
import { importDecks } from '@/data/decks';
import { clearImageCache, imageCacheStats } from '@/data/imageCache';
import { YGOPRODECK_IMAGES } from '@/data/types';
import { GAMES } from '@/games';
import { Chip, Sheet, Toast, TopBar, useToast } from '@/ui/components';
import { GAME_BLURB } from '@/ui/GameSwitch';

function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function SettingsPage() {
  const index = useCatalog();
  const game = useGame();
  const [settings, update] = useSettings();
  const [toast, showToast] = useToast();
  const [pendingImport, setPendingImport] = useState<unknown | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [exportText, setExportText] = useState<string | null>(null);
  const [imageBase, setImageBase] = useState(settings.ygoImageBase);
  const [cache, setCache] = useState<{ count: number; bytes: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (game.id !== 'ygo') return;
    let live = true;
    imageCacheStats().then((s) => live && setCache(s)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [game.id]);

  async function onExport() {
    const data = await exportCollection();
    const json = JSON.stringify(data, null, 2);
    const name = `cardcodex-collection-${data.exportedAt.slice(0, 10)}.json`;
    try {
      // Android: the public Downloads folder (src/app/saveFile.ts); browser: a download.
      const saved = await saveFile(new Blob([json], { type: 'application/json' }), name);
      showToast(`${savedMessage(saved, name)} · ${data.entries.length} entries, ${data.decks?.length ?? 0} decks`, 4000);
    } catch {
      // Nowhere to write (a denied permission, an old WebView): show the JSON to copy.
      setExportText(json);
    }
  }

  async function onPickFile(file: File | undefined) {
    if (!file) return;
    try {
      const text = await file.text();
      setPendingImport(JSON.parse(text));
    } catch {
      showToast('Could not read that file');
    }
  }

  async function doImport(mode: 'merge' | 'replace') {
    const data = pendingImport;
    setPendingImport(null);
    if (!data) return;
    try {
      const r = await importCollection(data, mode, index);
      const decks = await importDecks((data as { decks?: unknown }).decks, mode);
      showToast(`Imported ${r.imported} entries${decks ? `, ${decks} ${decks === 1 ? 'deck' : 'decks'}` : ''}${r.skipped ? `, skipped ${r.skipped}` : ''}`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Import failed');
    }
  }

  const groupsLine =
    game.id === 'pokemon'
      ? `${index.species.length} species`
      : game.id === 'mtg'
        ? `${new Set(index.catalog.cards.map((c) => c.oid)).size.toLocaleString()} distinct cards`
        : `${index.archetypes.length} archetypes, ${index.cardsByPasscode.size.toLocaleString()} distinct cards`;
  const rebuildCommand = game.id === 'pokemon' ? 'npm run catalog' : `npm run catalog:${game.id}`;

  return (
    <>
      <TopBar title="Settings" backTo="/collection" />
      <div className="settings">
        <section className="settings-section">
          <h2>Game</h2>
          <div className="game-options">
            {GAMES.map((g) => (
              <button
                key={g.id}
                type="button"
                className={`game-option${settings.game === g.id ? ' active' : ''}`}
                aria-pressed={settings.game === g.id}
                onClick={() => settings.game !== g.id && update({ game: g.id })}
              >
                <g.Icon size={28} />
                <span>
                  <strong>{g.name}</strong>
                  <small>{GAME_BLURB[g.id]}</small>
                </span>
              </button>
            ))}
          </div>
          <p className="hint">Each game has its own catalog, browse tab and scanner. Your collection keeps every game's cards.</p>
        </section>

        <section className="settings-section">
          <h2>Appearance</h2>
          <div className="setting-row">
            <span>Theme</span>
            <div className="chip-row inline">
              {(['system', 'dark', 'light'] as Theme[]).map((t) => (
                <Chip key={t} active={settings.theme === t} onClick={() => update({ theme: t })}>
                  {t[0].toUpperCase() + t.slice(1)}
                </Chip>
              ))}
            </div>
          </div>
          <div className="setting-row">
            <span>Card size</span>
            <div className="chip-row inline">
              {(['small', 'medium', 'large'] as TileSize[]).map((t) => (
                <Chip key={t} active={settings.tileSize === t} onClick={() => update({ tileSize: t })}>
                  {t[0].toUpperCase() + t.slice(1)}
                </Chip>
              ))}
            </div>
          </div>
          <label className="setting-row">
            <span>Dim cards you don't own in set binders</span>
            <input type="checkbox" checked={settings.dimMissing} onChange={(e) => update({ dimMissing: e.target.checked })} />
          </label>
          <label className="setting-row">
            <span>
              Each copy you own counts for one deck
              <small className="setting-note">A deck counts what your older decks left over. Turn off if you move cards between decks.</small>
            </span>
            <input type="checkbox" checked={settings.reserveDeckCopies} onChange={(e) => update({ reserveDeckCopies: e.target.checked })} />
          </label>
        </section>

        <section className="settings-section">
          <h2>Scanner</h2>
          <div className="setting-row">
            <span>Text recognition engine</span>
            <div className="chip-row inline">
              <Chip active={settings.scanEngine === 'auto'} onClick={() => update({ scanEngine: 'auto' })}>
                Auto
              </Chip>
              <Chip active={settings.scanEngine === 'tesseract'} onClick={() => update({ scanEngine: 'tesseract' })}>
                Tesseract only
              </Chip>
            </div>
          </div>
          <p className="hint">Auto uses on-device Google ML Kit on Android and Tesseract in the browser. Nothing is uploaded.</p>
          <div className="setting-row">
            <span>Default scan mode</span>
            <div className="chip-row inline">
              <Chip active={settings.scanMode === 'cards'} onClick={() => update({ scanMode: 'cards' })}>
                Single cards
              </Chip>
              <Chip active={settings.scanMode === 'page'} onClick={() => update({ scanMode: 'page' })}>
                Binder page
              </Chip>
            </div>
          </div>
          <div className="setting-row">
            <span>Binder page layout</span>
            <div className="chip-row inline">
              {PAGE_LAYOUTS.map((l) => (
                <Chip key={l.id} active={settings.pageLayout === l.id} onClick={() => update({ pageLayout: l.id })}>
                  {l.label}
                </Chip>
              ))}
            </div>
          </div>
        </section>

        <section className="settings-section">
          <h2>Guided tour</h2>
          <p className="hint">A short walk through the five tabs. It runs once on first launch; replay it any time.</p>
          <div className="btn-row">
            <button type="button" className="btn" onClick={() => openTour()}>
              {settings.tourDone ? 'Restart tour' : 'Start tour'}
            </button>
          </div>
        </section>

        {game.id === 'ygo' && (
          <section className="settings-section">
            <h2>Card images</h2>
            <p className="hint">
              YGOPRODeck asks apps not to hotlink its images, so each one is downloaded once and kept on this device. If you mirror the
              image folders yourself, point the app at that server instead.
            </p>
            <label className="setting-row column">
              <span>Image server</span>
              <input
                className="search-input"
                type="url"
                inputMode="url"
                placeholder={YGOPRODECK_IMAGES}
                value={imageBase}
                onChange={(e) => setImageBase(e.target.value)}
                onBlur={() => {
                  const v = imageBase.trim();
                  if (v !== settings.ygoImageBase) {
                    update({ ygoImageBase: v });
                    showToast(v ? 'Using your image server' : 'Using YGOPRODeck');
                  }
                }}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <p className="hint">Expected layout: {'<server>'}/cards_small/{'<passcode>'}.jpg and {'<server>'}/cards/{'<passcode>'}.jpg.</p>
            <div className="btn-row">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void clearImageCache().then(() => {
                    setCache({ count: 0, bytes: 0 });
                    showToast('Image cache cleared');
                  });
                }}
              >
                Clear stored images{cache ? ` (${cache.count.toLocaleString()} · ${formatBytes(cache.bytes)})` : ''}
              </button>
            </div>
          </section>
        )}

        <section className="settings-section">
          <h2>Backup</h2>
          <div className="btn-row">
            <button type="button" className="btn primary" onClick={() => void onExport()}>
              Export collection
            </button>
            <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
              Import…
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                void onPickFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
          <p className="hint">
            Your collection and decks live only on this device. The export holds every game's cards and decks; export a JSON backup before
            switching phones.
          </p>
          <button type="button" className="btn danger" onClick={() => setConfirmClear(true)}>
            Clear {game.short} collection
          </button>
        </section>

        <section className="settings-section">
          <h2>Catalog</h2>
          <p className="hint">
            {game.name}: {index.catalog.cards.length.toLocaleString()} {game.id === 'pokemon' ? 'cards' : 'printings'} across{' '}
            {index.catalog.sets.length.toLocaleString()} sets, {groupsLine}.
            <br />
            Built {new Date(index.catalog.builtAt).toLocaleDateString()}. {game.text.credits}
          </p>
          <p className="hint">
            To pick up new sets, rebuild the catalog with <code>{rebuildCommand}</code> and
            deploy: the web app loads the new data on its next start, the Android app with its next APK.
          </p>
        </section>

        <section className="settings-section">
          <h2>About</h2>
          <p className="hint">
            CardCodex v{__APP_VERSION__} · open source under GPL-3.0. Not affiliated with Nintendo, Creatures, GAME FREAK, The Pokémon
            Company, Konami, Shueisha or 4K Media.
          </p>
          <p className="hint">{GAMES.find((g) => g.id === 'mtg')?.text.disclaimer}</p>
        </section>
      </div>

      <Sheet open={pendingImport !== null} onClose={() => setPendingImport(null)} title="Import collection">
        <p>
          Merge adds the imported quantities to what you already have and keeps the newer copy of each deck. Replace wipes this device's
          collection and decks (every game) first.
        </p>
        <div className="sheet-actions">
          <button type="button" className="btn primary" onClick={() => void doImport('merge')}>
            Merge
          </button>
          <button type="button" className="btn danger" onClick={() => void doImport('replace')}>
            Replace
          </button>
          <button type="button" className="btn ghost" onClick={() => setPendingImport(null)}>
            Cancel
          </button>
        </div>
      </Sheet>

      <Sheet open={confirmClear} onClose={() => setConfirmClear(false)} title={`Clear your ${game.short} collection?`}>
        <p>
          This removes every owned {game.short} card, wishlist entry and note on this device. Cards of the other game are kept. Export
          first if you want a backup.
        </p>
        <div className="sheet-actions">
          <button
            type="button"
            className="btn danger"
            onClick={() => {
              setConfirmClear(false);
              void clearCollection(game.id).then(() => showToast(`${game.short} collection cleared`));
            }}
          >
            Clear {game.short} cards
          </button>
          <button type="button" className="btn ghost" onClick={() => setConfirmClear(false)}>
            Cancel
          </button>
        </div>
      </Sheet>

      <Sheet open={exportText !== null} onClose={() => setExportText(null)} title="Copy your backup">
        <textarea className="export-text" readOnly value={exportText ?? ''} onFocus={(e) => e.target.select()} />
        <div className="sheet-actions">
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              void navigator.clipboard?.writeText(exportText ?? '').then(() => showToast('Copied'));
            }}
          >
            Copy
          </button>
          <button type="button" className="btn ghost" onClick={() => setExportText(null)}>
            Close
          </button>
        </div>
      </Sheet>
      <Toast message={toast} />
    </>
  );
}
