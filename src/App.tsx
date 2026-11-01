import { lazy, Suspense, useEffect, useState } from 'react';
import { CatalogProvider } from '@/app/context';
import { useSettings } from '@/app/settings';
import { loadCatalog, type CatalogIndex } from '@/data/catalog';
import { BackpackIcon, BinderIcon, CameraIcon, PokeballIcon, SearchIcon } from '@/ui/icons';
import { href, useRoute, useScrollTopOnRoute } from '@/ui/router';
import DexPage from '@/pages/DexPage';
import SpeciesPage from '@/pages/SpeciesPage';
import SetsPage from '@/pages/SetsPage';
import SetPage from '@/pages/SetPage';
import CardPage from '@/pages/CardPage';
import SearchPage from '@/pages/SearchPage';
import CollectionPage from '@/pages/CollectionPage';
import SettingsPage from '@/pages/SettingsPage';

// The scanner pulls in OCR code; load it only when the user opens it.
const ScanPage = lazy(() => import('@/pages/ScanPage'));

const NAV = [
  { path: '/dex', label: 'Pokédex', Icon: PokeballIcon },
  { path: '/sets', label: 'Sets', Icon: BinderIcon },
  { path: '/search', label: 'Search', Icon: SearchIcon },
  { path: '/scan', label: 'Scan', Icon: CameraIcon },
  { path: '/collection', label: 'Collection', Icon: BackpackIcon },
];

export default function App() {
  const [index, setIndex] = useState<CatalogIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings] = useSettings();

  useEffect(() => {
    let cancelled = false;
    loadCatalog()
      .then((i) => {
        if (!cancelled) setIndex(i);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-tile', settings.tileSize);
  }, [settings.tileSize]);

  if (error) {
    return (
      <div className="splash">
        <PokeballIcon size={48} />
        <h1>CardCodex</h1>
        <p className="error">Could not load the card catalog: {error}</p>
        <button type="button" className="btn primary" onClick={() => window.location.reload()}>
          Retry
        </button>
      </div>
    );
  }
  if (!index) {
    return (
      <div className="splash">
        <PokeballIcon size={48} className="spin" />
        <h1>CardCodex</h1>
        <p>Loading card catalog…</p>
      </div>
    );
  }
  return (
    <CatalogProvider value={index}>
      <Shell />
    </CatalogProvider>
  );
}

function Shell() {
  const route = useRoute();
  const [section, arg] = route.segments;
  useScrollTopOnRoute(route.path);
  const isScan = section === 'scan';

  let page: React.ReactNode;
  switch (section) {
    case 'dex':
      page = arg ? <SpeciesPage id={Number(arg)} /> : <DexPage />;
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
      page = <DexPage />;
  }

  return (
    <div className={`app${isScan ? ' app-scan' : ''}`}>
      <main id="main" className="main">
        {page}
      </main>
      <nav className="bottom-nav" aria-label="Primary">
        {NAV.map(({ path, label, Icon }) => {
          const active = `/${section ?? 'dex'}` === path || (path === '/dex' && !section) || (path === '/sets' && section === 'card');
          return (
            <a key={path} href={href(path)} className={`nav-item${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined}>
              <Icon size={24} />
              <span>{label}</span>
            </a>
          );
        })}
      </nav>
    </div>
  );
}
