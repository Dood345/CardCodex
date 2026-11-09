/**
 * Magic: The Gathering profile. Set-first browsing (the Sets tab is the browse
 * tab), one catalog card per printing (set + collector number), the Oracle id
 * grouping the printings of one card, images from Scryfall's CDN. The scanner
 * is a minimal seam for now (./match.ts).
 */
import { loadCatalog, type CatalogIndex } from '@/data/catalog';
import { normalizeText } from '@/data/normalize';
import { cardImageUrl, type CatalogCard, type CatalogSet } from '@/data/types';
import { BinderIcon } from '@/ui/icons';
import { MTG_DECK_RULES, MTG_RULE_SETS } from '../deck-rules';
import type { Fact, GameProfile, QuickGroup } from '../types';
import { ManaIcon, ManaWheelIcon } from './icons';
import { createMtgMatcher } from './match';

function facts(card: CatalogCard, _set: CatalogSet, index: CatalogIndex): Fact[] {
  const out: Fact[] = [];
  if (card.sub) out.push({ label: 'Type', value: card.sub });
  if (card.cost) out.push({ label: 'Mana cost', value: <span className="mono">{card.cost}</span> });
  if (card.mv !== undefined) out.push({ label: 'Mana value', value: String(card.mv) });
  if (card.types?.length) {
    out.push({
      label: card.types.length > 1 ? 'Colors' : 'Color',
      value: (
        <span className="type-icon-label">
          {card.types.map((t) => (
            <ManaIcon key={t} type={t} size={20} />
          ))}{' '}
          {card.types.join(', ')}
        </span>
      ),
    });
  }
  if (card.pow !== undefined || card.tou !== undefined) out.push({ label: 'Power / Toughness', value: `${card.pow ?? '?'} / ${card.tou ?? '?'}` });
  if (card.loy !== undefined) out.push({ label: 'Loyalty', value: card.loy });
  if (card.dfn !== undefined) out.push({ label: 'Defense', value: card.dfn });
  if (card.rarity) out.push({ label: 'Rarity', value: card.rarity });
  if (card.artist) out.push({ label: 'Artist', value: card.artist });
  const printings = index.cardsByName.get(normalizeText(card.name))?.length ?? 1;
  out.push({ label: 'Printings', value: String(printings) });
  return out;
}

/** Oracle cards whose name matches the query, each linking to its newest printing. */
function quickGroups(index: CatalogIndex, query: string): QuickGroup[] {
  const q = normalizeText(query);
  if (q.length < 2 || /^\d+$/.test(q)) return [];
  const starts: QuickGroup[] = [];
  const contains: QuickGroup[] = [];
  for (const [name, cards] of index.cardsByName) {
    const hit = name.startsWith(q) ? starts : name.includes(q) ? contains : null;
    if (!hit || contains.length >= 8) continue;
    const newest = cards[0];
    hit.push({
      key: newest.oid ?? name,
      name: newest.name,
      sub: `${cards.length} ${cards.length === 1 ? 'printing' : 'printings'}`,
      href: `/card/${newest.id}`,
      img: cardImageUrl(newest, '', 'low'),
    });
    if (starts.length >= 8) break;
  }
  return [...starts, ...contains].slice(0, 8);
}

export const mtg: GameProfile = {
  id: 'mtg',
  name: 'Magic: The Gathering',
  short: 'Magic',
  Icon: ManaWheelIcon,
  load: () => loadCatalog('mtg'),
  cardMm: { w: 63, h: 88 },
  // No Pokédex or archetypes: the sets are the way in, so the first tab is Sets (App.tsx drops the duplicate tab).
  browse: { path: '/sets', label: 'Sets', Icon: BinderIcon },
  categories: ['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Planeswalker', 'Battle', 'Land'],
  typeLabel: 'Color',
  TypeIcon: ManaIcon,
  seriesLabel: 'Year',
  groupLabel: 'distinct cards',
  facts,
  quickGroups,
  text: {
    searchPlaceholder: 'Lightning Bolt, Goblin, LEA 161…',
    searchSubtitle: 'Cards, types, sets, set codes, collector numbers or artists',
    searchEmptyHint: 'Try a shorter name, a set code like BLB, or a set code and collector number like LEA 161.',
    searchFindHint: 'Search by card name, type line, set, set code, collector number or artist.',
    scanIntro:
      'Point the camera at one card. Magic scanning is basic for now: CardCodex reads the card name and the set code and collector number at the bottom-left, and asks which printing you have when the name alone cannot tell.',
    scanHint: 'Hold one card inside the frame. The name at the top-left and the set code and number at the bottom-left must be sharp.',
    scanPhotoHint: 'Fill the frame with one card, keep it flat and well lit, and make sure the name and the small set code and number at the bottom-left are sharp.',
    tourWelcome:
      'A binder for your Magic: The Gathering collection, printing by printing. This quick tour shows the four tabs; skip it any time and restart it from Settings, where you can also switch to Pokémon or Yu-Gi-Oh!.',
    tourBrowseTitle: 'Sets',
    tourBrowse:
      'Your binders: every set by year with a completion bar. Inside a set, turn on Quick add and each tap on a card adds one copy.',
    tourSearch:
      'Find any printing by name, type line, set, set code, collector number like LEA 161, or artist. Filters narrow by owned, card type, color, rarity and year.',
    tourScan: 'Point the camera at a card: the name, set code and collector number identify it. Magic scanning is basic for now.',
    credits:
      'Built from Scryfall bulk data. Card images from Scryfall; card images and data © Wizards of the Coast. CardCodex is not produced by or endorsed by Scryfall.',
    disclaimer:
      'CardCodex is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.',
  },
  deckRules: MTG_DECK_RULES,
  deckRuleSets: MTG_RULE_SETS,
  // The scanner's seam: a name + collector-number matcher until the real one exists (see ./match.ts).
  createMatcher: (index) => createMtgMatcher(index.catalog),
};
