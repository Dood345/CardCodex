import { lazy, Suspense, useEffect, useState } from 'react';
import { CatalogProvider, useGame } from '@/app/context';
import { useSettings } from '@/app/settings';
import { openTour, useTourOpen } from '@/app/tourState';
import { Tour } from '@/ui/Tour';
import type { CatalogIndex } from '@/data/catalog';
import { configureYgoImages } from '@/data/types';
import { gameById } from '@/games';
import { installDeepLinks } from '@/app/deepLinks';
import { installBackButton } from '@/ui/back';
import { BackpackIcon, BinderIcon, CameraIcon, SearchIcon } from '@/ui/icons';
import { href, navigate, usePaneScroll, useRoute } from '@/ui/router';
import DexPage from '@/pages/DexPage';
import SpeciesPage from '@/pages/SpeciesPage';
import NameGroupPage from '@/pages/NameGroupPage';
import ArchetypesPage from '@/pages/ArchetypesPage';
import ArchetypePage from '@/pages/ArchetypePage';
import SetsPage from '@/pages/SetsPage';
import SetPage from '@/pages/SetPage';
import CardPage from '@/pages/CardPage';
import SearchPage from '@/pages/SearchPage';
import CollectionPage from '@/pages/CollectionPage';
import DeckPage from '@/pages/DeckPage';
import DeckImportPage from '@/pages/DeckImportPage';
import DeckBuildPage from '@/pages/DeckBuildPage';
import StarterDeckPage from '@/pages/StarterDeckPage';
import SettingsPage from '@/pages/SettingsPage';

// The scanner pulls in OCR code; load it only when the user opens it.
const ScanPage = lazy(() => import('@/pages/ScanPage'));

/** Browse-tab route keys per game; a stale hash from the other game redirects. */
const BROWSE_KEYS = new Set(['dex', 'archetypes']);

export default function App() {
  const [settings] = useSettings();
  const game = gameById(settings.game);
  const [index, setIndex] = useState<CatalogIndex | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => configureYgoImages(settings.ygoImageBase), [settings.ygoImageBase]);
  // Android's back button closes what is on top before it leaves a page (src/ui/back.ts).
  useEffect(() => installBackButton(), []);
  // cardcodex://deck/<code> links open a shared deck (src/app/deepLinks.ts).
  useEffect(() => installDeepLinks(), []);

  useEffect(() => {
    let cancelled = false;
    setIndex(null);
    setError(null);
    game
      .load()
      .then((i) => {
        if (!cancelled) setIndex(i);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [game]);

  useEffect(() => {
    document.documentElement.setAttribute('data-tile', settings.tileSize);
  }, [settings.tileSize]);

  if (error) {
    return (
      <div className="splash">
        <game.Icon size={48} />
        <h1>CardCodex</h1>
        <p className="error">Could not load the {game.name} catalog: {error}</p>
        <button type="button" className="btn primary" onClick={() => window.location.reload()}>
          Retry
        </button>
      </div>
    );
  }
  if (!index) {
    return (
      <div className="splash">
        <game.Icon size={48} className="spin" />
        <h1>CardCodex</h1>
        <p>Loading {game.name} catalog…</p>
      </div>
    );
  }
  return (
    <CatalogProvider value={index}>
      <Shell key={game.id} />
    </CatalogProvider>
  );
}

function Shell() {
  const route = useRoute();
  const game = useGame();
  const [section, arg] = route.segments;
  usePaneScroll(route);
  const isScan = section === 'scan';
  const tourOpen = useTourOpen();
  const [settings] = useSettings();
  const browseKey = game.browse.path.slice(1);

  // First launch: start the guided tour once the catalog is on screen.
  useEffect(() => {
    if (!settings.tourDone) openTour();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "#/dex" while Yu-Gi-Oh! is active (or the reverse): show this game's browse tab.
  useEffect(() => {
    if (section && BROWSE_KEYS.has(section) && section !== browseKey) navigate(game.browse.path, true);
  }, [section, browseKey, game.browse.path]);

  const nav = [
    { key: 'browse', path: game.browse.path, label: game.browse.label, Icon: game.browse.Icon },
    { key: 'sets', path: '/sets', label: 'Sets', Icon: BinderIcon },
    { key: 'search', path: '/search', label: 'Search', Icon: SearchIcon },
    { key: 'scan', path: '/scan', label: 'Scan', Icon: CameraIcon },
    { key: 'collection', path: '/collection', label: 'Collection', Icon: BackpackIcon },
    // A game whose browse tab is Sets (Magic) gets four tabs, not two Sets.
  ].filter((n) => n.key === 'browse' || n.path !== game.browse.path);

  let page: React.ReactNode;
  switch (section) {
    case 'dex':
      // `/dex/<number>` is a species; `/dex/name/<key>` every printing of a Trainer or Energy name.
      page =
        arg === 'name' ? (
          <NameGroupPage key={route.segments[2]} nameKey={route.segments[2] ?? ''} />
        ) : arg ? (
          <SpeciesPage id={Number(arg)} />
        ) : (
          <DexPage />
        );
      break;
    case 'archetypes':
      page = arg ? <ArchetypePage name={arg} /> : <ArchetypesPage />;
      break;
    case 'sets':
      page = arg ? <SetPage id={arg} /> : <SetsPage />;
      break;
    case 'card':
      page = <CardPage id={arg ?? ''} />;
      break;
    case 'search':
      page = <SearchPage route={route} />;
      break;
    case 'collection':
      page = <CollectionPage />;
      break;
    case 'decks':
      page =
        arg === 'import' ? (
          <DeckImportPage code={route.segments[2] ?? ''} />
        ) : arg === 'build' ? (
          <DeckBuildPage key={route.segments[2] ?? ''} seed={route.segments[2]} />
        ) : arg === 'starter' && route.segments[2] ? (
          <StarterDeckPage id={route.segments[2]} />
        ) : arg ? <DeckPage id={arg} /> : <CollectionPage />;
      break;
    case 'settings':
      page = <SettingsPage />;
      break;
    case 'scan':
      page = (
        <Suspense fallback={<div className="splash small">Loading scanner…</div>}>
          <ScanPage />
        </Suspense>
      );
      break;
    default:
      page = browseKey === 'archetypes' ? <ArchetypesPage /> : browseKey === 'sets' ? <SetsPage /> : <DexPage />;
  }

  return (
    <div className={`app${isScan ? ' app-scan' : ''}`}>
      <main id="main" className="main">
        {page}
      </main>
      <nav className="bottom-nav" aria-label="Primary">
        {nav.map(({ key, path, label, Icon }) => {
          const active =
            `/${section ?? browseKey}` === path ||
            (path === game.browse.path && !section) ||
            (path === '/sets' && section === 'card') ||
            (path === '/collection' && section === 'decks');
          return (
            <a
              key={key}
              href={href(path)}
              className={`nav-item${active ? ' active' : ''}`}
              aria-current={active ? 'page' : undefined}
              data-tour={`nav-${key}`}
            >
              <Icon size={24} />
              <span>{label}</span>
            </a>
          );
        })}
      </nav>
      {tourOpen && <Tour />}
    </div>
  );
}
