/**
 * Shared presentational components.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useBackHandler } from './back';
import type { CatalogCard, CatalogSet, Species } from '@/data/types';
import { cardImageUrl, speciesSpriteUrl } from '@/data/types';
import type { CatalogIndex } from '@/data/catalog';
import { formatCardNumber } from '@/data/catalog';
import type { CollectionEntry } from '@/data/db';
import { adjustQty } from '@/data/collection';
import { cachedImageUrl, isCacheableImage, resolveImage } from '@/data/imageCache';
import { ManaIcon } from '@/games/mtg/icons';
import { CardBackFor } from './CardBack';
import { AttributeIcon, BackIcon, EnergyIcon, GAME_TYPE_COLORS, HeartIcon, MinusIcon, PlusIcon, PokeballIcon } from './icons';
import { href, back } from './router';

/* ---------- layout ---------- */

export function TopBar({
  title,
  subtitle,
  backTo,
  actions,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  backTo?: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="topbar">
      <div className="topbar-row">
        {backTo !== undefined && (
          <button className="icon-btn" aria-label="Back" onClick={() => back(backTo)}>
            <BackIcon />
          </button>
        )}
        <div className="topbar-titles">
          <h1 className="topbar-title">{title}</h1>
          {subtitle && <div className="topbar-subtitle">{subtitle}</div>}
        </div>
        {actions && <div className="topbar-actions">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {hint && <div className="empty-hint">{hint}</div>}
      {action}
    </div>
  );
}

export function ProgressBar({ value, max, label }: { value: number; max: number; label?: ReactNode }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="progress" role="progressbar" aria-valuenow={value} aria-valuemax={max}>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="progress-label">
        {label ?? (
          <>
            {value}/{max} · {pct}%
          </>
        )}
      </div>
    </div>
  );
}

export function Chip({
  active,
  onClick,
  children,
  color,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  color?: string;
}) {
  return (
    <button
      type="button"
      className={`chip${active ? ' active' : ''}`}
      onClick={onClick}
      style={color ? ({ '--chip-color': color } as React.CSSProperties) : undefined}
    >
      {children}
    </button>
  );
}

/* ---------- images ---------- */

/**
 * Source to hand to an <img>: the URL itself, or for hosts whose images must
 * be stored rather than hotlinked (see data/imageCache.ts) the cached copy,
 * fetched once. Undefined while that lookup is in flight.
 */
function useCachedSrc(src: string | undefined, wanted: boolean): string | undefined {
  const cacheable = isCacheableImage(src);
  const [resolved, setResolved] = useState<string | undefined>(() => (cacheable ? cachedImageUrl(src) : src));
  useEffect(() => {
    if (!cacheable) {
      setResolved(src);
      return;
    }
    const hit = cachedImageUrl(src);
    if (hit) {
      setResolved(hit);
      return;
    }
    setResolved(undefined);
    if (!wanted) return;
    let live = true;
    void resolveImage(src).then((u) => {
      if (live) setResolved(u);
    });
    return () => {
      live = false;
    };
  }, [src, cacheable, wanted]);
  return resolved;
}

/**
 * True once `el` has come within `margin` of the viewport (or at once when
 * `eager`). Stored images are only fetched for tiles the user is about to
 * see, not for every tile of a 600-row grid.
 */
function useNearViewport(el: HTMLElement | null, eager: boolean | undefined, margin = '300px'): boolean {
  const [near, setNear] = useState(!!eager || typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (near || !el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [el, near, margin]);
  return near;
}

/** Image with skeleton while loading and a text fallback on error. */
export function Img({
  src,
  alt,
  className,
  fallback,
  eager,
}: {
  src?: string;
  alt: string;
  className?: string;
  fallback?: ReactNode;
  eager?: boolean;
}) {
  const [sentinel, setSentinel] = useState<HTMLElement | null>(null);
  const near = useNearViewport(sentinel, eager);
  const cached = useCachedSrc(src, near);
  // A stored copy that fails to decode (evicted object URL) falls back to the plain URL once.
  const [direct, setDirect] = useState(false);
  const effective = direct ? src : cached;
  const [state, setState] = useState<'loading' | 'ok' | 'error'>(src ? 'loading' : 'error');
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    setState(src ? 'loading' : 'error');
    setDirect(false);
  }, [src]);
  useEffect(() => {
    // Cached images may already be complete before onLoad is attached.
    const img = ref.current;
    if (img && img.complete && img.naturalWidth > 0) setState('ok');
  }, [effective]);
  if (!src || state === 'error') {
    return <div className={`img-fallback ${className ?? ''}`}>{fallback ?? alt}</div>;
  }
  return (
    <>
      {state === 'loading' && <div ref={setSentinel} className={`img-skeleton ${className ?? ''}`} />}
      {effective && (
        <img
          ref={ref}
          src={effective}
          alt={alt}
          className={`${className ?? ''}${state === 'loading' ? ' img-hidden' : ''}`}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onLoad={() => setState('ok')}
          onError={() => {
            if (!direct && effective !== src) setDirect(true);
            else setState('error');
          }}
          draggable={false}
        />
      )}
    </>
  );
}

/* ---------- cards ---------- */

export function CardTile({
  card,
  set,
  entry,
  dim,
  showSet,
  sub,
  onClick,
}: {
  card: CatalogCard;
  set: CatalogSet | undefined;
  entry: CollectionEntry | undefined;
  /** Dim cards that are not owned (set binder view). */
  dim?: boolean;
  showSet?: boolean;
  /** Replaces the "set · number" caption line. */
  sub?: ReactNode;
  onClick?: () => void;
}) {
  const owned = !!entry && entry.qty > 0;
  const url = set ? cardImageUrl(card, set.series, 'low') : undefined;
  const body = (
    <>
      {/* Scryfall's image terms (Magic): the copyright, printed bottom-right, stays visible and colors are not altered. */}
      <div className={`card-art${dim && !owned ? ' card-missing' : ''}${card.sid ? ' scryfall-art' : ''}`}>
        <Img src={url} alt={card.name} className="card-img" fallback={<CardPlaceholder card={card} />} />
        {owned && <span className="qty-badge">×{entry!.qty}</span>}
        {entry?.wanted ? (
          <span className="want-badge" title="Wanted">
            <HeartIcon size={12} filled />
          </span>
        ) : null}
      </div>
      <div className="card-caption">
        <div className="card-name" title={card.name}>
          {card.name}
        </div>
        <div className="card-sub">
          {sub ?? (
            <>
              {showSet && set ? `${set.name} · ` : ''}
              {formatCardNumber(card, set)}
            </>
          )}
        </div>
      </div>
    </>
  );
  if (onClick) {
    return (
      <button type="button" className="card-tile" onClick={onClick}>
        {body}
      </button>
    );
  }
  return (
    <a className="card-tile" href={href(`/card/${card.id}`)}>
      {body}
    </a>
  );
}

/** A card with no picture: a drawn card back in the game's colour, with the card's type icon and name. */
export function CardPlaceholder({ card }: { card: CatalogCard }) {
  const type = card.types?.[0];
  return (
    <CardBackFor card={card}>
      {type ? (
        card.pc !== undefined ? (
          <AttributeIcon type={type} size={28} />
        ) : card.sid ? (
          <ManaIcon type={type} size={28} />
        ) : (
          <EnergyIcon type={type} size={28} />
        )
      ) : undefined}
    </CardBackFor>
  );
}

export function CardGrid({ children }: { children: ReactNode }) {
  return <div className="card-grid">{children}</div>;
}

/** Compact +/- control used on tiles and lists. */
export function QtyStepper({ cardId, qty, size = 'md' }: { cardId: string; qty: number; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <div className={`stepper stepper-${size}`} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="stepper-btn"
        aria-label="Remove one"
        disabled={qty <= 0}
        onClick={() => void adjustQty(cardId, -1)}
      >
        <MinusIcon size={size === 'lg' ? 22 : 16} />
      </button>
      <span className="stepper-value">{qty}</span>
      <button type="button" className="stepper-btn" aria-label="Add one" onClick={() => void adjustQty(cardId, 1)}>
        <PlusIcon size={size === 'lg' ? 22 : 16} />
      </button>
    </div>
  );
}

/* ---------- species ---------- */

export function TypePill({ type }: { type: string }) {
  const color = GAME_TYPE_COLORS[type] ?? '#888';
  return (
    <span className="type-pill" style={{ background: color }}>
      {type}
    </span>
  );
}

export function dexNumber(id: number): string {
  return `#${String(id).padStart(4, '0')}`;
}

export function SpeciesTile({
  species,
  owned,
  total,
}: {
  species: Species;
  /** Distinct cards owned featuring this species. */
  owned: number;
  /** Cards in the catalog featuring this species. */
  total: number;
}) {
  const primary = GAME_TYPE_COLORS[species.types[0] ?? ''] ?? '#888';
  const secondary = GAME_TYPE_COLORS[species.types[1] ?? species.types[0] ?? ''] ?? primary;
  const state = total === 0 ? 'none' : owned === 0 ? 'missing' : 'owned';
  return (
    <a
      className={`species-tile species-${state}`}
      href={href(`/dex/${species.id}`)}
      style={{ '--t1': primary, '--t2': secondary } as React.CSSProperties}
    >
      <div className="species-sprite-wrap">
        <Img src={speciesSpriteUrl(species.id)} alt={species.name} className="species-sprite" fallback={<PokeballIcon size={40} className="sprite-missing" />} />
      </div>
      <div className="species-num">{dexNumber(species.id)}</div>
      <div className="species-name">{species.name}</div>
      <div className="species-count">
        {total === 0 ? 'no cards' : `${owned}/${total}`}
      </div>
    </a>
  );
}

/** Row showing the set's logo/symbol and a progress bar. */
export function SetRow({
  set,
  owned,
  total,
  index,
}: {
  set: CatalogSet;
  owned: number;
  total: number;
  index: CatalogIndex;
}) {
  void index;
  return (
    <a className="set-row" href={href(`/sets/${set.id}`)}>
      <SetBadge set={set} />
      <div className="set-row-body">
        <div className="set-row-name">{set.name}</div>
        <div className="set-row-meta">
          {set.abbr ? `${set.abbr} · ` : ''}
          {set.releaseDate ? set.releaseDate.slice(0, 4) : 'unknown'} · {set.total} cards
        </div>
        <ProgressBar value={owned} max={total} />
      </div>
    </a>
  );
}

export function SetBadge({ set, size = 44 }: { set: CatalogSet; size?: number }) {
  const symbol = set.symbol ? `https://assets.tcgdex.net/en/${set.series}/${set.id}/symbol.webp` : undefined;
  const text = set.abbr || set.id.slice(0, 4).toUpperCase();
  return (
    <div className="set-badge" style={{ width: size, height: size }}>
      <Img src={symbol} alt={set.name} className="set-symbol" fallback={<span className={text.length > 3 ? 'long' : ''}>{text}</span>} />
    </div>
  );
}

/* ---------- sheets / dialogs ---------- */

export function Sheet({
  open,
  onClose,
  title,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  /** Extra class on the sheet itself (a taller sheet, say). */
  className?: string;
  children: ReactNode;
}) {
  // Android back and Escape both close the sheet.
  useBackHandler(open, onClose);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="backdrop" onClick={onClose}>
      <div className={`sheet${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        {title && <div className="sheet-title">{title}</div>}
        {children}
      </div>
    </div>
  );
}

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="toast" role="status">
      {message}
    </div>
  );
}

/** Simple toast state helper. */
export function useToast(): [string | null, (msg: string, ms?: number) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = (m: string, ms = 2200) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), ms);
  };
  return [msg, show];
}
