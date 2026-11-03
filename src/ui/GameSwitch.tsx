/**
 * Game switcher pill (browse and collection top bars). Opens a sheet with
 * one option per game; picking one reloads the catalog and opens that
 * game's browse tab. The collection keeps every game's cards.
 */
import { useState } from 'react';
import { useSettings } from '@/app/settings';
import { GAMES, gameById } from '@/games';
import { Sheet } from './components';
import { navigate } from './router';

/** One line per game under its name in the game pickers (here and Settings). */
export const GAME_BLURB: Record<string, string> = {
  pokemon: 'Pokédex, sets, printed numbers',
  ygo: 'Archetypes, sets, set codes and passcodes',
  mtg: 'Sets, printings and collector numbers',
};

export function GameSwitch({ compact }: { compact?: boolean }) {
  const [settings, update] = useSettings();
  const [open, setOpen] = useState(false);
  const game = gameById(settings.game);
  return (
    <>
      <button type="button" className="game-switch" onClick={() => setOpen(true)} aria-label={`Game: ${game.name}. Switch game`} title="Switch game">
        <game.Icon size={18} />
        {!compact && <span>{game.short}</span>}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Which game?">
        <div className="game-options">
          {GAMES.map((g) => (
            <button
              key={g.id}
              type="button"
              className={`game-option${g.id === settings.game ? ' active' : ''}`}
              aria-pressed={g.id === settings.game}
              onClick={() => {
                setOpen(false);
                if (g.id !== settings.game) {
                  update({ game: g.id });
                  navigate(g.browse.path, true);
                }
              }}
            >
              <g.Icon size={28} />
              <span>
                <strong>{g.name}</strong>
                <small>{GAME_BLURB[g.id]}</small>
              </span>
            </button>
          ))}
        </div>
        <p className="hint">Your collection keeps every game's cards; switching only changes what the app shows and scans.</p>
      </Sheet>
    </>
  );
}
