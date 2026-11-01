/**
 * Pokémon TCG profile: the original CardCodex game. Pokédex-first browsing,
 * TCGdex images (hotlinkable), printed "057/198" numbers.
 */
import { loadCatalog, type CatalogIndex } from '@/data/catalog';
import { searchSpecies } from '@/data/search';
import { speciesSpriteUrl, type CatalogCard, type CatalogSet } from '@/data/types';
import { createPokemonMatcher } from '@/scanner/match';
import { dexNumber } from '@/ui/components';
import { EnergyIcon, PokeballIcon } from '@/ui/icons';
import { href } from '@/ui/router';
import type { Fact, GameProfile, QuickGroup } from './types';

function facts(card: CatalogCard, _set: CatalogSet, index: CatalogIndex): Fact[] {
  const out: Fact[] = [
    { label: 'Category', value: `${card.cat}${card.stage ? ` · ${card.stage}` : ''}` },
  ];
  if (card.types) {
    out.push({
      label: 'Type',
      value: (
        <span className="type-icons">
          {card.types.map((t) => (
            <span key={t} className="type-icon-label">
              <EnergyIcon type={t} size={20} /> {t}
            </span>
          ))}
        </span>
      ),
    });
  }
  if (card.hp !== undefined) out.push({ label: 'HP', value: card.hp });
  if (card.rarity) out.push({ label: 'Rarity', value: card.rarity });
  const species = (card.dex ?? []).map((d) => index.speciesById.get(d)).filter((s): s is NonNullable<typeof s> => !!s);
  if (species.length) {
    out.push({
      label: 'Pokédex',
      value: (
        <span className="species-links">
          {species.map((s) => (
            <a key={s.id} className="species-link" href={href(`/dex/${s.id}`)}>
              <img src={speciesSpriteUrl(s.id)} alt="" width={32} height={32} />
              {dexNumber(s.id)} {s.name}
            </a>
          ))}
        </span>
      ),
    });
  }
  return out;
}

function quickGroups(index: CatalogIndex, query: string): QuickGroup[] {
  if (!query.trim() || /\//.test(query)) return [];
  return searchSpecies(index, query, 8).map((s) => ({
    key: String(s.id),
    name: s.name,
    sub: dexNumber(s.id),
    href: `/dex/${s.id}`,
    img: speciesSpriteUrl(s.id),
    pixel: true,
  }));
}

export const pokemon: GameProfile = {
  id: 'pokemon',
  name: 'Pokémon TCG',
  short: 'Pokémon',
  Icon: PokeballIcon,
  load: () => loadCatalog('pokemon'),
  cardMm: { w: 63, h: 88 },
  browse: { path: '/dex', label: 'Pokédex', Icon: PokeballIcon },
  categories: ['Pokemon', 'Trainer', 'Energy'],
  typeLabel: 'Type',
  TypeIcon: EnergyIcon,
  seriesLabel: 'Series',
  groupLabel: 'species',
  facts,
  quickGroups,
  text: {
    searchPlaceholder: 'Pikachu, Base Set, SVI, 004/102…',
    searchSubtitle: 'Cards, sets, numbers like 57/198',
    searchEmptyHint: 'Try a shorter name, a set code like SVI, or a number like 25/102.',
    searchFindHint: 'Search by Pokémon, card name, set, set code or printed number.',
    scanIntro:
      'Point the camera at one or more cards. CardCodex reads the name, HP and the printed number and shows a chip over each card it recognises. Tap a chip to add that card, or open the alternatives to correct it.',
    scanHint: 'Hold a card inside the frame. Good light and a flat angle help; the number at the bottom-left is the strongest clue.',
    scanPhotoHint: 'Fill the frame with one card, keep it flat and well lit, and make sure the name and the number at the bottom-left are sharp.',
    tourWelcome:
      'A Pokédex for your Pokémon TCG collection. This quick tour shows the five tabs; skip it any time and restart it from Settings, where you can also switch to Yu-Gi-Oh!.',
    tourBrowseTitle: 'Pokédex',
    tourBrowse:
      'Every species, with silhouettes for the ones you own no cards of. Tap a Pokémon to see all of its cards, newest first, and what you have.',
    tourSearch:
      'Find any card by name, set, set code like SVI, or the printed number such as 057/198. Filters narrow by owned, type, rarity and series.',
    tourScan:
      'Point the camera at cards to add them with a tap, or switch to Binder page mode to read a whole page at once and confirm how many copies sit in each pocket.',
    credits: 'Built from TCGdex and PokéAPI. Card images © The Pokémon Company; served by TCGdex.',
    disclaimer: 'Not affiliated with Nintendo, Creatures, GAME FREAK or The Pokémon Company.',
  },
  createMatcher: (index) => createPokemonMatcher(index.catalog),
};
