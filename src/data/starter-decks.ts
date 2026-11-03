/**
 * Starter decks: ready-made deck lists shipped under public/data/<game>/decks.json
 * (scripts/decks-ygo.mjs builds the Yu-Gi-Oh! file from the Structure and Starter
 * Decks), ranked by how much of each the collection already covers.
 */
import { useEffect, useState } from 'react';
import { fetchDataJson } from './catalog';
import type { CollectionMap } from './collection';
import type { DeckCard } from './db';
import { summarizeDeck } from './decks';
import type { GameId } from '@/games/ids';

export interface StarterDeck {
  id: string;
  name: string;
  game: GameId;
  /** Release date of the product, "" when unknown. */
  date?: string;
  source: { name: string; url: string };
  note: string;
  /** [card id, copies] */
  cards: [string, number][];
}

export interface StarterDeckFile {
  version: number;
  game: GameId;
  builtAt: string;
  decks: StarterDeck[];
}

/** The data file (under public/data) holding a game's starter decks, or null when the game has none. */
export function starterFileFor(game: GameId): string | null {
  if (game === 'ygo') return 'ygo/decks.json';
  return null;
}

const loaded = new Map<GameId, Promise<StarterDeck[]>>();

/** The game's starter decks, fetched once; empty when the game has no file or it cannot be read. */
export function loadStarterDecks(game: GameId): Promise<StarterDeck[]> {
  const file = starterFileFor(game);
  if (!file) return Promise.resolve([]);
  let p = loaded.get(game);
  if (!p) {
    p = fetchDataJson<StarterDeckFile>(file)
      .then((f) => (Array.isArray(f.decks) ? f.decks.filter((d) => d.game === game) : []))
      .catch(() => []);
    loaded.set(game, p);
  }
  return p;
}

/** Starter decks of the game, `null` while they load. */
export function useStarterDecks(game: GameId): StarterDeck[] | null {
  const [state, setState] = useState<{ game: GameId; decks: StarterDeck[] } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadStarterDecks(game).then((decks) => {
      if (!cancelled) setState({ game, decks });
    });
    return () => {
      cancelled = true;
    };
  }, [game]);
  return state && state.game === game ? state.decks : null;
}

export function toDeckCards(deck: StarterDeck): DeckCard[] {
  return deck.cards.map(([cardId, qty]) => ({ cardId, qty }));
}

export interface RankedStarter {
  deck: StarterDeck;
  total: number;
  covered: number;
  /** Covered share, 0..1. */
  coverage: number;
}

/**
 * The decks ordered by coverage, fullest first; ties go to the larger covered
 * count, then the newer deck, then the name, so the order is stable.
 * `known` (optional) limits a deck to cards the loaded catalog has.
 */
export function rankStarterDecks(decks: readonly StarterDeck[], collection: CollectionMap, known?: (cardId: string) => boolean): RankedStarter[] {
  const ranked = decks.map((deck) => {
    const cards = toDeckCards(deck).filter((c) => !known || known(c.cardId));
    const s = summarizeDeck(cards, collection);
    return { deck, total: s.total, covered: s.covered, coverage: s.total ? s.covered / s.total : 0 };
  });
  return ranked.sort(
    (a, b) =>
      b.coverage - a.coverage ||
      b.covered - a.covered ||
      (b.deck.date ?? '').localeCompare(a.deck.date ?? '') ||
      a.deck.name.localeCompare(b.deck.name),
  );
}
