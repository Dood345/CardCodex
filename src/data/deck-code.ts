/**
 * A deck as a short code that travels in a text message, with no server
 * behind it: `CCD1.` and the deck (game, name, card ids and counts) as JSON,
 * deflated and base64url-encoded. A 60-card deck is a few hundred
 * characters. The code is found anywhere in a pasted message, so a friend
 * can forward the whole share text, and `cardcodex://deck/<code>` opens
 * the app on it (src/app/deepLinks.ts).
 */
import type { DeckCard } from './db';
import { isGameId, type GameId } from '@/games/ids';

export interface DeckShare {
  game: GameId;
  name: string;
  cards: DeckCard[];
}

const PREFIX = 'CCD1.';
const CODE_RE = /CCD1\.[A-Za-z0-9_-]{4,}/;
/** Scheme links that open the app on a deck. */
export const DECK_LINK_PREFIX = 'cardcodex://deck/';

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  const writer = stream.writable.getWriter();
  void writer.write(bytes);
  void writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

/** The share code for a deck. */
export async function encodeDeck(deck: DeckShare): Promise<string> {
  // A side-deck line gains a third element, 's'. The format stays v1: a
  // 1.5.0 reader ignores the extra element and puts those copies in the deck.
  const lines = deck.cards.map((c) => (c.zone === 'side' ? [c.cardId, c.qty, 's'] : [c.cardId, c.qty]));
  const json = JSON.stringify({ v: 1, g: deck.game, n: deck.name, c: lines });
  const packed = await pipe(new TextEncoder().encode(json), new CompressionStream('deflate-raw'));
  return PREFIX + toBase64Url(packed);
}

/** The deck code inside any text (a share message, a link), or null. */
export function findDeckCode(text: string): string | null {
  const m = text.match(CODE_RE);
  return m ? m[0] : null;
}

/** The deck a code (or a text carrying one) describes. Throws on anything that is not one. */
export async function decodeDeck(text: string): Promise<DeckShare> {
  const code = findDeckCode(text);
  if (!code) throw new Error('No CardCodex deck code in that text.');
  let raw: unknown;
  try {
    const bytes = await pipe(fromBase64Url(code.slice(PREFIX.length)), new DecompressionStream('deflate-raw'));
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('That deck code is damaged.');
  }
  const r = raw as { v?: unknown; g?: unknown; n?: unknown; c?: unknown };
  if (!r || r.v !== 1 || !isGameId(r.g) || typeof r.n !== 'string' || !Array.isArray(r.c)) throw new Error('That is not a CardCodex deck.');
  const cards: DeckCard[] = [];
  for (const line of r.c) {
    if (!Array.isArray(line) || typeof line[0] !== 'string') continue;
    const qty = Math.min(99, Math.floor(Number(line[1])));
    if (qty > 0) cards.push(line[2] === 's' ? { cardId: line[0], qty, zone: 'side' } : { cardId: line[0], qty });
  }
  return { game: r.g, name: r.n.trim().slice(0, 80) || 'Shared deck', cards };
}

/** The message that goes out: a readable deck list, then how to open it. */
export function deckShareText(deck: DeckShare, gameName: string, lines: readonly string[], code: string): string {
  const total = deck.cards.reduce((n, c) => n + c.qty, 0);
  return [
    `${deck.name} · ${gameName} deck · ${total} ${total === 1 ? 'card' : 'cards'}`,
    ...lines,
    '',
    `Open in CardCodex: ${DECK_LINK_PREFIX}${code}`,
    'No app? Paste this message into Collection → Decks → Import.',
  ].join('\n');
}
