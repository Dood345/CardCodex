/**
 * Yu-Gi-Oh! TCG profile. Archetype-first browsing, one catalog card per
 * printing (set code), images from YGOPRODeck stored on the device after the
 * first view (their guide forbids hotlinking), passcode + set code scanning.
 */
import { loadCatalog, type CatalogIndex } from '@/data/catalog';
import { normalizeText } from '@/data/normalize';
import { cardImageUrl, type CatalogCard, type CatalogSet } from '@/data/types';
import { createYgoMatcher } from '@/scanner/ygo/match';
import { ArchetypeIcon, AttributeIcon, MillenniumIcon } from '@/ui/icons';
import { href } from '@/ui/router';
import { YGO_DECK_RULES } from '../deck-rules';
import type { Fact, GameProfile, QuickGroup } from '../types';
import { levelLabel } from './catalog';

/** "?" stats are stored as -1 by the source. */
const stat = (v: number | undefined) => (v === undefined ? undefined : v < 0 ? '?' : String(v));

function facts(card: CatalogCard, _set: CatalogSet, index: CatalogIndex): Fact[] {
  const out: Fact[] = [{ label: 'Card type', value: card.sub ?? card.cat }];
  const attr = card.types?.[0];
  if (attr) {
    out.push({
      label: 'Attribute',
      value: (
        <span className="type-icon-label">
          <AttributeIcon type={attr} size={20} /> {attr}
        </span>
      ),
    });
  }
  if (card.race) out.push({ label: card.cat === 'Monster' ? 'Type' : 'Property', value: card.race });
  if (card.lv !== undefined) {
    const label = levelLabel(card);
    const stars = label === 'Link' ? '' : ' ' + '★'.repeat(Math.min(12, Math.max(0, card.lv)));
    out.push({ label, value: `${card.lv}${stars}` });
  }
  const atk = stat(card.atk);
  const def = stat(card.def);
  if (atk !== undefined || def !== undefined) {
    out.push({ label: card.frame === 'link' ? 'ATK' : 'ATK / DEF', value: card.frame === 'link' ? atk ?? '?' : `${atk ?? '?'} / ${def ?? '?'}` });
  }
  if (card.arc) {
    const group = index.cardsByArchetype.get(card.arc);
    out.push({
      label: 'Archetype',
      value: (
        <a className="link-row" href={href(`/archetypes/${encodeURIComponent(card.arc)}`)}>
          {card.arc}
          {group ? ` · ${new Set(group.map((c) => c.pc)).size} cards` : ''}
        </a>
      ),
    });
  }
  if (card.rarity) out.push({ label: 'Rarity', value: card.rarity });
  if (card.pc !== undefined) {
    out.push({ label: 'Passcode', value: <span className="mono">{String(card.pc).padStart(8, '0')}</span> });
  }
  return out;
}

/** The archetype's most reprinted card: a stable, recognisable thumbnail. */
export function archetypeCover(index: CatalogIndex, name: string): CatalogCard | undefined {
  const cards = index.cardsByArchetype.get(name);
  if (!cards?.length) return undefined;
  const count = new Map<number, number>();
  for (const c of cards) if (c.pc !== undefined) count.set(c.pc, (count.get(c.pc) ?? 0) + 1);
  let best = cards[0];
  let bestN = -1;
  for (const c of cards) {
    const n = count.get(c.pc ?? -1) ?? 0;
    // Prefer the card named exactly like the archetype ("Dark Magician"), then the most printed.
    const bonus = normalizeText(c.name) === normalizeText(name) ? 1000 : 0;
    if (n + bonus > bestN) {
      bestN = n + bonus;
      best = c;
    }
  }
  return best;
}

function quickGroups(index: CatalogIndex, query: string): QuickGroup[] {
  const q = normalizeText(query);
  if (!q || /^\d+$/.test(q)) return [];
  const starts: QuickGroup[] = [];
  const contains: QuickGroup[] = [];
  for (const a of index.archetypes) {
    const n = normalizeText(a.name);
    const hit = n.startsWith(q) ? starts : n.includes(q) ? contains : null;
    if (!hit) continue;
    const cover = archetypeCover(index, a.name);
    hit.push({
      key: a.name,
      name: a.name,
      sub: `${a.unique} ${a.unique === 1 ? 'card' : 'cards'}`,
      href: `/archetypes/${encodeURIComponent(a.name)}`,
      img: cover ? cardImageUrl(cover, '', 'low') : undefined,
    });
    if (starts.length >= 8) break;
  }
  return [...starts, ...contains].slice(0, 8);
}

export const ygo: GameProfile = {
  id: 'ygo',
  name: 'Yu-Gi-Oh! TCG',
  short: 'Yu-Gi-Oh!',
  Icon: MillenniumIcon,
  load: () => loadCatalog('ygo'),
  cardMm: { w: 59, h: 86 },
  browse: { path: '/archetypes', label: 'Archetypes', Icon: ArchetypeIcon },
  categories: ['Monster', 'Spell', 'Trap'],
  typeLabel: 'Attribute',
  TypeIcon: AttributeIcon,
  seriesLabel: 'Year',
  groupLabel: 'archetypes',
  facts,
  quickGroups,
  text: {
    searchPlaceholder: 'Blue-Eyes, LOB-EN001, 46986414…',
    searchSubtitle: 'Cards, archetypes, sets, set codes or passcodes',
    searchEmptyHint: 'Try a shorter name, a set code like LOB-EN001, or the 8-digit passcode printed bottom-left.',
    searchFindHint: 'Search by card name, archetype, monster type, set, set code or passcode.',
    scanIntro:
      'Point the camera at one or more cards. CardCodex reads the name, the set code under the artwork and the 8-digit passcode at the bottom-left, and shows a chip over each card it recognises. Tap a chip to add that printing, or open the alternatives to correct it.',
    scanHint:
      'Hold a card inside the frame. The set code under the artwork names the exact printing and the passcode at the bottom-left names the card; keep both sharp.',
    scanPhotoHint:
      'Fill the frame with one card, keep it flat and well lit, and make sure the set code under the artwork and the small passcode at the bottom-left are sharp.',
    tourWelcome:
      'A binder for your Yu-Gi-Oh! collection, printing by printing. This quick tour shows the five tabs; skip it any time and restart it from Settings, where you can also switch back to Pokémon.',
    tourBrowseTitle: 'Archetypes',
    tourBrowse:
      'Every archetype with how many of its cards you own. Tap one to see its cards, newest printing first; cards outside any archetype are a search away.',
    tourSearch:
      'Find any printing by name, archetype, set, set code like LOB-EN001 or the 8-digit passcode. Filters narrow by owned, attribute, rarity and year.',
    tourScan:
      'Point the camera at cards: the set code under the artwork and the passcode at the bottom-left identify the exact printing. Binder page mode reads a whole page at once.',
    credits:
      'Built from the YGOPRODeck API. Card images © Konami Digital Entertainment, served by YGOPRODeck and stored on this device after the first view, as their terms ask.',
    disclaimer: 'Not affiliated with Konami, Shueisha or 4K Media.',
  },
  deckRules: YGO_DECK_RULES,
  createMatcher: (index) => createYgoMatcher(index.catalog),
};
