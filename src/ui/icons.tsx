/**
 * Inline SVG icons: navigation glyphs and the eleven TCG energy types.
 * Energy icons are drawn as simple recognizable glyphs on the canonical
 * energy colours so cards and filters read at a glance.
 */
import type { CSSProperties } from 'react';

interface IconProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

export function PokeballIcon({ size = 24, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h6M15 12h6" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function BinderIcon({ size = 24, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 3v18M12 8h5M12 12h5M12 16h3" />
    </svg>
  );
}

export function SearchIcon({ size = 24, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function BackpackIcon({ size = 24, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <path d="M8 6V5a4 4 0 0 1 8 0v1" />
      <rect x="4" y="6" width="16" height="15" rx="3" />
      <path d="M4 13h16M9 13v3M15 13v3" />
    </svg>
  );
}

export function CameraIcon({ size = 24, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

export function BackIcon({ size = 24, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

export function GearIcon({ size = 24, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

export function HeartIcon({ size = 24, className, style, filled = false }: IconProps & { filled?: boolean }) {
  return (
    <svg {...base(size)} className={className} style={style} fill={filled ? 'currentColor' : 'none'}>
      <path d="M12 21s-7-4.6-9.3-9A5.3 5.3 0 0 1 12 6.2 5.3 5.3 0 0 1 21.3 12C19 16.4 12 21 12 21z" />
    </svg>
  );
}

export function CheckIcon({ size = 24, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <path d="m5 12 4.5 4.5L19 7" />
    </svg>
  );
}

export function CloseIcon({ size = 24, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function PlusIcon({ size = 24, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function MinusIcon({ size = 24, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <path d="M5 12h14" />
    </svg>
  );
}

export function FilterIcon({ size = 24, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <path d="M4 5h16l-6 8v5l-4 2v-7z" />
    </svg>
  );
}

export function GridIcon({ size = 24, className, style }: IconProps) {
  return (
    <svg {...base(size)} className={className} style={style}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

/* ---------- TCG energy types ---------- */

export const ENERGY_COLORS: Record<string, string> = {
  Grass: '#4caf50',
  Fire: '#f44336',
  Water: '#2196f3',
  Lightning: '#ffc107',
  Psychic: '#9c27b0',
  Fighting: '#b5651d',
  Darkness: '#37474f',
  Metal: '#90a4ae',
  Fairy: '#ec407a',
  Dragon: '#c9a227',
  Colorless: '#cfd8dc',
};

/** Game (Pokédex) type colours for species iconography. */
export const GAME_TYPE_COLORS: Record<string, string> = {
  normal: '#a8a77a',
  fire: '#ee8130',
  water: '#6390f0',
  electric: '#f7d02c',
  grass: '#7ac74c',
  ice: '#96d9d6',
  fighting: '#c22e28',
  poison: '#a33ea1',
  ground: '#e2bf65',
  flying: '#a98ff3',
  psychic: '#f95587',
  bug: '#a6b91a',
  rock: '#b6a136',
  ghost: '#735797',
  dragon: '#6f35fc',
  dark: '#705746',
  steel: '#b7b7ce',
  fairy: '#d685ad',
};

function energyGlyph(type: string) {
  switch (type) {
    case 'Grass':
      return <path d="M12 5c-4 0-7 3-7 7 0 2 .7 3.6 2 4.8L12 7v12c3.9 0 7-3.1 7-7 0-4-3-7-7-7z" fill="#fff" />;
    case 'Fire':
      return <path d="M12 4c1 3 4 4 4 8a4 4 0 0 1-8 0c0-1.5.6-2.6 1.3-3.4C9.5 10 10 11 11 11c0-3-1-4 1-7z" fill="#fff" />;
    case 'Water':
      return <path d="M12 4c3 4 5 6.5 5 9.5a5 5 0 0 1-10 0C7 10.5 9 8 12 4z" fill="#fff" />;
    case 'Lightning':
      return <path d="M13 3 6 13h5l-1 8 8-11h-5l1-7z" fill="#fff" />;
    case 'Psychic':
      return (
        <>
          <circle cx="12" cy="12" r="6.5" fill="none" stroke="#fff" strokeWidth="2" />
          <circle cx="12" cy="12" r="2.2" fill="#fff" />
        </>
      );
    case 'Fighting':
      return <path d="M8 6h3v4h2V6h3v7l-1.5 4h-5L8 13z" fill="#fff" />;
    case 'Darkness':
      return <path d="M15.5 5A7 7 0 1 0 19 13.5 6 6 0 0 1 15.5 5z" fill="#fff" />;
    case 'Metal':
      return <path d="M12 4l7 4v8l-7 4-7-4V8z" fill="none" stroke="#fff" strokeWidth="2.2" />;
    case 'Fairy':
      return <path d="M12 4l1.6 5.4L19 11l-5.4 1.6L12 18l-1.6-5.4L5 11l5.4-1.6z" fill="#fff" />;
    case 'Dragon':
      return <path d="M6 14c2-6 7-8 12-7-1 2-2 3-4 3.5 1 1 1 2.5 0 4-1-1-2-1.5-3-1.5-.5 2-2 3.5-5 4 .5-1.3.5-2.3 0-3z" fill="#fff" />;
    default:
      return <path d="M12 5l2 5h5l-4 3 1.5 5L12 15l-4.5 3L9 13 5 10h5z" fill="#fff" />;
  }
}

/** Round TCG energy badge for a type name such as "Lightning". */
export function EnergyIcon({ type, size = 18, className, style }: { type: string } & IconProps) {
  const color = ENERGY_COLORS[type] ?? '#9e9e9e';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      style={style}
      role="img"
      aria-label={`${type} type`}
    >
      <title>{type}</title>
      <circle cx="12" cy="12" r="11" fill={color} />
      <circle cx="12" cy="12" r="11" fill="none" stroke="rgba(0,0,0,.25)" strokeWidth="1" />
      {energyGlyph(type)}
    </svg>
  );
}
