/**
 * Build a deck: pick one to three cards to build around (or take one of the
 * ideas), say where cards may come from and for which format, and the
 * recommender grows a full deck from them. The result shows its score part
 * by part, what the collection covers and how the deck came together; "Keep
 * this deck" saves it like any other deck, "Build another" tries again
 * without the cards of the last attempt.
 */
import { useEffect, useMemo, useState } from 'react';
import { useCatalog, useGame } from '@/app/context';
import { useCollection } from '@/data/collection';
import { createDeck, summarizeDeck, useDecks } from '@/data/decks';
import { searchCards } from '@/data/search';
import { cardImageUrl, type CatalogCard } from '@/data/types';
import { hasRecommender } from '@/recommend';
import { builtDeckName, describeMove, formatsOf, namesInDecks, namesToVary, seedIdeas } from '@/recommend/advice';
import { buildDeck, type BuildResult } from '@/recommend/builder';
import type { BuildOptions } from '@/recommend/types';
import { EmptyState, Img, TopBar } from '@/ui/components';
import { CloseIcon } from '@/ui/icons';
import { href, navigate } from '@/ui/router';
import { advisorMemory, BuildChoices, SCORE_NOTE, ScoreParts, useEvaluator } from './deck/DeckAdvisor';
import { DeckSections } from './DeckSections';

const MAX_SEEDS = 3;

export default function DeckBuildPage({ seed }: { seed?: string }) {
  const index = useCatalog();
  const game = useGame();
  const collection = useCollection();
  const decks = useDecks(game.id);
  const supported = hasRecommender(game.id);
  const { ev, error } = useEvaluator(supported);
  const [seeds, setSeeds] = useState<CatalogCard[]>(() => {
    const card = seed ? index.cardsById.get(seed) : undefined;
    return card ? [card] : [];
  });
  const [query, setQuery] = useState('');
  const [source, setSource] = useState(advisorMemory.source);
  const [format, setFormat] = useState(advisorMemory.format[game.id] ?? 'any');
  const [avoidOthers, setAvoidOthers] = useState(false);
  const [building, setBuilding] = useState(false);
  const [result, setResult] = useState<BuildResult | null>(null);
  const [varied, setVaried] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState(false);

  const formats = useMemo(() => (ev ? formatsOf(ev) : []), [ev]);
  const options = useMemo<BuildOptions>(() => ({ source, collection, format }), [source, collection, format]);
  const pool = useMemo(() => (ev ? ev.pool(options) : []), [ev, options]);
  // Ideas come from the user's own cards when the source prefers them and they own enough to choose from.
  const ownedPool = useMemo(() => (source === 'catalog' ? [] : pool.filter((c) => (collection.get(c.id)?.qty ?? 0) > 0)), [source, pool, collection]);
  const fromOwned = source === 'collection' || ownedPool.length >= 20;
  const ideas = useMemo(() => (ev ? seedIdeas(ev, fromOwned ? ownedPool : pool, 8) : []), [ev, fromOwned, ownedPool, pool]);
  const results = useMemo(() => (query.trim() ? searchCards(index, query, {}, collection, 12).cards : []), [index, query, collection]);

  // A different start or different rules make the last deck stale.
  useEffect(() => {
    setResult(null);
    setVaried(new Set());
  }, [seeds, source, format, avoidOthers]);

  if (!supported) {
    return (
      <>
        <TopBar title="Build a deck" backTo="/collection" />
        <EmptyState
          title={`Not for ${game.short} yet`}
          hint="The deck builder reads each card’s rules text, and that is not in place for this game yet."
          action={
            <a className="btn" href={href('/collection')}>
              Back to the collection
            </a>
          }
        />
      </>
    );
  }

  const addSeed = (card: CatalogCard) => {
    setQuery('');
    setSeeds((s) => (s.some((c) => c.name === card.name) || s.length >= MAX_SEEDS ? s : [...s, card]));
  };
  const run = (avoidMore: Set<string>) => {
    if (!ev || !seeds.length) return;
    setBuilding(true);
    // Let "Building…" paint before the builder takes the thread.
    window.setTimeout(() => {
      const avoid = new Set(avoidMore);
      if (avoidOthers) for (const n of namesInDecks(ev, decks)) avoid.add(n);
      for (const s of seeds) avoid.delete(s.name);
      const opts = { ...options, avoid };
      setResult(
        buildDeck(
          ev,
          seeds.map((c) => c.id),
          opts,
          ev.pool(opts),
        ),
      );
      setBuilding(false);
    }, 60);
  };
  const another = () => {
    if (!ev || !result) return;
    const next = new Set(varied);
    for (const n of namesToVary(ev, result.cards, seeds)) next.add(n);
    setVaried(next);
    run(next);
  };
  const keep = async () => {
    if (!result) return;
    setSaving(true);
    const deck = await createDeck(game.id, builtDeckName(seeds), result.cards);
    navigate(`/decks/${deck.id}`, true);
  };

  const summary = result ? summarizeDeck(result.cards, collection) : null;

  return (
    <>
      <TopBar title="Build a deck" subtitle={`${game.short} · from one to three cards you choose`} backTo="/collection">
        <div className="toolbar">
          <input
            className="search-input"
            type="search"
            placeholder={seeds.length >= MAX_SEEDS ? 'Three cards chosen' : 'Build around: card name…'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={seeds.length >= MAX_SEEDS}
            autoComplete="off"
          />
        </div>
      </TopBar>

      {query.trim() &&
        (results.length ? (
          <section className="deck-section">
            <h2 className="section-title">Build around</h2>
            <div className="scan-candidates">
              {results.map((card) => {
                const set = index.setsById.get(card.set);
                return (
                  <button key={card.id} type="button" className="scan-candidate build-pick" onClick={() => addSeed(card)}>
                    {set ? <Img src={cardImageUrl(card, set.series, 'low')} alt="" /> : <span />}
                    <div className="cand-body">
                      <div className="cand-name">{card.name}</div>
                      <div className="cand-sub">{set?.name ?? card.set}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        ) : (
          <p className="deck-hint">No cards match.</p>
        ))}

      <section className="deck-section build-setup">
        {seeds.length > 0 ? (
          <div className="build-seeds">
            {seeds.map((c) => (
              <span key={c.id} className="build-seed">
                {c.name}
                <button type="button" aria-label={`Remove ${c.name}`} onClick={() => setSeeds((s) => s.filter((x) => x.id !== c.id))}>
                  <CloseIcon size={14} />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="deck-hint build-lead">Search for the card the deck should be built around, or start from an idea below.</p>
        )}

        {error && <p className="deck-hint">The card texts could not be loaded. Go back and open this page again.</p>}
        {!error && ev === undefined && <p className="deck-hint">Reading the card texts…</p>}
        {ev && (
          <>
            <BuildChoices
              source={source}
              onSource={(s) => {
                advisorMemory.source = s;
                setSource(s);
              }}
              formats={formats}
              format={format}
              onFormat={(f) => {
                advisorMemory.format[game.id] = f;
                setFormat(f);
              }}
            />
            {decks.length > 0 && (
              <label className="build-check">
                <input type="checkbox" checked={avoidOthers} onChange={(e) => setAvoidOthers(e.target.checked)} />
                Leave out cards my other decks already use
              </label>
            )}
            {seeds.length < MAX_SEEDS && ideas.length > 0 && !query.trim() && (
              <>
                <h3 className="advisor-sub">{fromOwned ? 'Ideas from your cards' : 'Ideas'}</h3>
                <div className="chip-row inline build-ideas">
                  {ideas
                    .filter((c) => !seeds.some((s) => s.name === c.name))
                    .map((c) => (
                      <button key={c.id} type="button" className="chip" onClick={() => addSeed(c)}>
                        {c.name}
                      </button>
                    ))}
                </div>
              </>
            )}
            {source === 'collection' && pool.length === 0 && (
              <p className="deck-hint">Your collection has no cards for this format yet. Try “Prefer my cards”.</p>
            )}
            <div className="deck-actions build-actions">
              <button type="button" className="btn primary" disabled={!seeds.length || building} onClick={() => run(new Set())}>
                {building ? 'Building…' : result ? 'Build again' : 'Build the deck'}
              </button>
            </div>
          </>
        )}
      </section>

      {result && summary && ev && (
        <>
          <section className="deck-section advisor build-result">
            <div className="advisor-head static">
              <span className="advisor-title">{builtDeckName(seeds)}</span>
              <span className="advisor-total">
                {Math.round(result.score.total)}
                <small>/100</small>
              </span>
            </div>
            <p className="deck-hint">
              {summary.total} cards · you own {summary.covered} · {summary.short} missing
            </p>
            {result.dropped.length > 0 && (
              <p className="deck-hint advisor-warn">
                Left out, not available under these choices: {result.dropped.join(', ')}.
              </p>
            )}
            {result.score.issues.length > 0 && (
              <ul className="advisor-issues">
                {result.score.issues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            )}
            <ScoreParts score={result.score} />
            <div className="deck-actions build-actions">
              <button type="button" className="btn primary" disabled={saving} onClick={() => void keep()}>
                Keep this deck
              </button>
              <button type="button" className="btn" disabled={building} onClick={another}>
                {building ? 'Building…' : 'Build another'}
              </button>
            </div>
            <p className="deck-hint advisor-note">{SCORE_NOTE}</p>
          </section>
          <DeckSections game={game} cards={result.cards} index={index} collection={collection} />
          {result.steps.length > 0 && (
            <details className="deck-section build-steps">
              <summary>How this deck came together ({result.steps.length} steps)</summary>
              <ol>
                {result.steps.map((s, i) => (
                  <li key={i}>
                    {describeMove(s)} <span className="cand-sub">{s.reason}</span>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </>
      )}
    </>
  );
}
