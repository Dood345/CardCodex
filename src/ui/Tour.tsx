/**
 * Guided tour: a handful of coach marks that walk through the main tabs.
 * Each step may navigate to a route and spotlight an element marked with a
 * `data-tour` attribute. Skippable at any step; Settings can restart it.
 * The wording comes from the active game's profile.
 */
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useBackHandler } from '@/ui/back';
import { useGame } from '@/app/context';
import { updateSettings } from '@/app/settings';
import { closeTour } from '@/app/tourState';
import type { GameProfile } from '@/games/types';
import { navigate } from './router';

interface TourStep {
  title: string;
  body: string;
  /** Hash route to show for this step. */
  route?: string;
  /** `data-tour` value of the element to spotlight. */
  target?: string;
}

export function tourSteps(game: GameProfile): TourStep[] {
  return [
    { title: 'Welcome to CardCodex', body: game.text.tourWelcome },
    { title: game.text.tourBrowseTitle, route: game.browse.path, target: 'nav-browse', body: game.text.tourBrowse },
    {
      title: 'Sets',
      route: '/sets',
      target: 'nav-sets',
      body: 'Your binders: every set with a completion bar. Inside a set, turn on Quick add and each tap on a card adds one copy.',
    },
    { title: 'Search', route: '/search', target: 'nav-search', body: game.text.tourSearch },
    { title: 'Scan', route: '/scan', target: 'nav-scan', body: game.text.tourScan },
    {
      title: 'Collection',
      route: '/collection',
      target: 'nav-collection',
      body: 'Totals, everything you own grouped by set, and your wishlist. The gear opens Settings: game, theme, backups, scanner options and this tour.',
    },
    {
      title: "You're all set",
      body: 'Start by scanning a few cards or opening a set. Your collection stays on this device; export a backup from Settings whenever you like.',
    },
  ];
}

const PAD = 8;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function measure(target: string | undefined): Rect | null {
  if (!target) return null;
  const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: r.left - PAD, y: r.top - PAD, w: r.width + 2 * PAD, h: r.height + 2 * PAD };
}

export function Tour() {
  const game = useGame();
  const steps = useMemo(() => tourSteps(game), [game]);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  // Android back skips the tour, like Escape.
  useBackHandler(true, finish);
  const step = steps[Math.min(i, steps.length - 1)];
  const last = i >= steps.length - 1;

  useEffect(() => {
    if (step.route) navigate(step.route);
  }, [step]);

  useLayoutEffect(() => {
    const update = () => setRect(measure(step.target));
    // Measure now (nav targets exist on every route), again once the step's
    // route has rendered, and follow resizes. Timers rather than rAF: a
    // background tab pauses rAF and would leave the spotlight on the old step.
    update();
    const timer = window.setTimeout(update, 150);
    window.addEventListener('resize', update);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', update);
    };
  }, [step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
      if (e.key === 'ArrowRight' || e.key === 'Enter') next();
      if (e.key === 'ArrowLeft') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function finish() {
    updateSettings({ tourDone: true });
    closeTour();
  }
  function next() {
    if (last) finish();
    else setI((n) => n + 1);
  }
  function back() {
    setI((n) => Math.max(0, n - 1));
  }

  // Put the card above the spotlight when the target is in the lower half (the nav bar), else below.
  const vh = window.innerHeight;
  const cardStyle: React.CSSProperties = rect
    ? rect.y > vh / 2
      ? { bottom: vh - rect.y + 12 }
      : { top: rect.y + rect.h + 12 }
    : { top: '50%', transform: 'translate(-50%, -50%)' };

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label="Guided tour">
      {rect ? (
        <div className="tour-spotlight" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} />
      ) : (
        <div className="tour-dim" />
      )}
      <div className="tour-card" style={cardStyle}>
        <div className="tour-step">
          {i + 1} / {steps.length}
        </div>
        <h2>{step.title}</h2>
        <p>{step.body}</p>
        <div className="tour-actions">
          <button type="button" className="btn ghost" onClick={finish}>
            Skip tour
          </button>
          <span className="tour-spacer" />
          {i > 0 && (
            <button type="button" className="btn" onClick={back}>
              Back
            </button>
          )}
          <button type="button" className="btn primary" onClick={next} autoFocus>
            {last ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
