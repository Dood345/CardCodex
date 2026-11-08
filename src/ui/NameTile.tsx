/**
 * A Pokédex tile for a Trainer or Energy name: the newest printing's picture,
 * the name and the owned count, styled like a species tile.
 */
import { useCatalog } from '@/app/context';
import type { NameGroup } from '@/data/name-groups';
import { cardImageUrl } from '@/data/types';
import { Img } from './components';
import { href } from './router';

export function NameTile({ group, owned }: { group: NameGroup; owned: number }) {
  const index = useCatalog();
  const total = group.cards.length;
  const card = group.cards[0];
  const set = index.setsById.get(card.set);
  const state = owned === 0 ? 'missing' : 'owned';
  return (
    <a className={`species-tile name-tile species-${state}`} href={href(`/dex/name/${encodeURIComponent(group.key)}`)}>
      <div className="species-sprite-wrap">
        <Img src={set ? cardImageUrl(card, set.series, 'low') : undefined} alt={group.name} className="name-tile-img" fallback={<span>?</span>} />
      </div>
      <div className="species-name">{group.name}</div>
      <div className="species-count">
        {owned}/{total}
      </div>
    </a>
  );
}
