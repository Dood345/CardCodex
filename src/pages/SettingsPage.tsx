import { useRef, useState } from 'react';
import { useCatalog } from '@/app/context';
import { useSettings, type Theme, type TileSize } from '@/app/settings';
import { openTour } from '@/app/tourState';
import { PAGE_LAYOUTS } from '@/scanner/page';
import { clearCollection, exportCollection, importCollection } from '@/data/collection';
import { Chip, Sheet, Toast, TopBar, useToast } from '@/ui/components';

const isNative = typeof (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform === 'function'
  && (window as unknown as { Capacitor: { isNativePlatform: () => boolean } }).Capacitor.isNativePlatform();

export default function SettingsPage() {
  const index = useCatalog();
  const [settings, update] = useSettings();
  const [toast, showToast] = useToast();
  const [pendingImport, setPendingImport] = useState<unknown | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [exportText, setExportText] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onExport() {
    const data = await exportCollection();
    const json = JSON.stringify(data, null, 2);
    const name = `cardcodex-collection-${data.exportedAt.slice(0, 10)}.json`;
    try {
      if (isNative && 'share' in navigator && 'canShare' in navigator) {
        const file = new File([json], name, { type: 'application/json' });
        if ((navigator as Navigator & { canShare: (d: ShareData) => boolean }).canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: 'CardCodex collection' });
          return;
        }
      }
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      showToast(`Exported ${data.entries.length} entries`);
    } catch {
      // Fallback for WebViews that block downloads: show the JSON to copy.
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
      showToast(`Imported ${r.imported} entries${r.skipped ? `, skipped ${r.skipped}` : ''}`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Import failed');
    }
  }

  return (
    <>
      <TopBar title="Settings" backTo="/collection" />
      <div className="settings">
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
          <p className="hint">Your collection lives only on this device. Export a JSON backup before switching phones.</p>
          <button type="button" className="btn danger" onClick={() => setConfirmClear(true)}>
            Clear collection
          </button>
        </section>

        <section className="settings-section">
          <h2>Catalog</h2>
          <p className="hint">
            {index.catalog.cards.length.toLocaleString()} cards across {index.catalog.sets.length} sets, {index.species.length} species.
            <br />
            Built {new Date(index.catalog.builtAt).toLocaleDateString()} from TCGdex and PokéAPI. Card images © The Pokémon
            Company; served by TCGdex.
          </p>
          <p className="hint">
            To pick up new sets, rebuild the catalog with <code>npm run catalog</code> and ship a new build.
          </p>
        </section>

        <section className="settings-section">
          <h2>About</h2>
          <p className="hint">
            CardCodex v{__APP_VERSION__} · open source under GPL-3.0. Not affiliated with Nintendo, Creatures, GAME FREAK or
            The Pokémon Company.
          </p>
        </section>
      </div>

      <Sheet open={pendingImport !== null} onClose={() => setPendingImport(null)} title="Import collection">
        <p>Merge adds the imported quantities to what you already have. Replace wipes this device's collection first.</p>
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

      <Sheet open={confirmClear} onClose={() => setConfirmClear(false)} title="Clear your collection?">
        <p>This removes every owned card, wishlist entry and note on this device. Export first if you want a backup.</p>
        <div className="sheet-actions">
          <button
            type="button"
            className="btn danger"
            onClick={() => {
              setConfirmClear(false);
              void clearCollection().then(() => showToast('Collection cleared'));
            }}
          >
            Clear everything
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
