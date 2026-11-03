/**
 * Magic: The Gathering icons, drawn plainly (no mana-symbol artwork): the game
 * icon is five dots on a ring, one per color, and a color is a disc in its
 * color with its WUBRG letter.
 */
import type { CSSProperties } from 'react';

interface IconProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
}

/** Five colors around a ring: the game switch icon. */
export function ManaWheelIcon({ size = 24, className, style }: IconProps) {
  const dots = [0, 1, 2, 3, 4].map((i) => {
    const a = (-90 + i * 72) * (Math.PI / 180);
    return { cx: 12 + 7.5 * Math.cos(a), cy: 12 + 7.5 * Math.sin(a) };
  });
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className} style={style} aria-hidden>
      <circle cx="12" cy="12" r="7.5" strokeWidth={1.2} />
      {dots.map((d, i) => (
        <circle key={i} cx={d.cx} cy={d.cy} r="2.6" fill="currentColor" stroke="none" />
      ))}
    </svg>
  );
}

export const MANA_COLORS: Record<string, { fill: string; ink: string; letter: string }> = {
  White: { fill: '#f4efd2', ink: '#5b5132', letter: 'W' },
  Blue: { fill: '#2a77c4', ink: '#ffffff', letter: 'U' },
  Black: { fill: '#2f2b29', ink: '#e8e2dc', letter: 'B' },
  Red: { fill: '#d4412f', ink: '#ffffff', letter: 'R' },
  Green: { fill: '#2f8a4c', ink: '#ffffff', letter: 'G' },
  Colorless: { fill: '#c9c2bd', ink: '#3d3836', letter: 'C' },
};

/** A Magic color ("Blue") as a lettered disc; `CatalogCard.types` holds these names. */
export function ManaIcon({ type, size = 18, className, style }: { type: string } & IconProps) {
  const c = MANA_COLORS[type] ?? { fill: '#9e9e9e', ink: '#ffffff', letter: '?' };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} style={style} role="img" aria-label={`${type}`}>
      <title>{type}</title>
      <circle cx="12" cy="12" r="11" fill={c.fill} />
      <circle cx="12" cy="12" r="11" fill="none" stroke="rgba(0,0,0,.25)" strokeWidth="1" />
      <text x="12" y="16.5" textAnchor="middle" fontSize="13" fontWeight="700" fontFamily="system-ui, sans-serif" fill={c.ink}>
        {c.letter}
      </text>
    </svg>
  );
}
