/**
 * Build a deck: pick one to three cards to build around (or take one of the
 * ideas), say where cards may come from and for which format, and the
 * recommender grows a full deck from them. The result shows its score part
 * by part, what the collection covers and how the deck came together; "Keep
 * this deck" saves it like any other deck, "Build another" tries again
 * without the cards of the last attempt. Where the game has a playtest
 * simulator the result also says how the deck played, and "Tune by playing"
 * improves it swap by swap.
 */
import { useEffect, useMemo, useState } from 'react';
import { useCatalog, useGame } from '@/app/context';
import { useCollection } from '@/data/collection';
import { createDeck, summarizeDeck, useClaims, useDecks } from '@/data/decks';
import { searchCards } from '@/data/search';
import { cardImageUrl, type CatalogCard } from '@/data/types';
import { hasRecommender } from '@/recommend';
import { builtDeckName, defaultFormat, describeMove, evaluatorFor, formatsOf, namesInDecks, namesToVary, PLAY_GAMES, seedIdeas } from '@/recommend/advice';
import { buildDeck, type BuildResult } from '@/recommend/builder';
import { canTune, tuneRound, tuneStart, type TuneState } from '@/recommend/tune';
import type { BuildOptions, PlaySummary } from '@/recommend/types';
import { EmptyState, Img, TopBar } from '@/ui/components';
import { CloseIcon } from '@/ui/icons';
import { href, navigate } from '@/ui/router';
import { advisorMemory, BuildChoices, PlayLines, PracticeBlock, SCORE_NOTE, ScoreParts, useEvaluator, usePool } from './deck/DeckAdvisor';
import { DeckSections } from './DeckSections';

const MAX_SEEDS = 3;
/** Rounds of tuning by play per tap: enough to matter, short enough to wait for on a phone. */
const TUNE_ROUNDS = 8;

export default function DeckBuildPage({ seed }: { seed?: string }) {
  const index = useCatalog();
  const game = useGame();
  const collection = useCollection();
  // Not a saved deck yet: every saved deck has first call on the copies it uses.
  const claims = useClaims(game.id, undefined, collection);
  const decks = useDecks(game.id);
  const supported = hasRecommender(game.id);
  const { ev: loaded, error } = useEvaluator(supported);
  const [seeds, setSeeds] = useState<CatalogCard[]>(() => {
    const card = seed ? index.cardsById.get(seed) : undefined;
    return card ? [card] : [];
  });
  const [query, setQuery] = useState('');
  const [source, setSource] = useState(advisorMemory.source);
  const [chosen, setFormat] = useState<string | undefined>(advisorMemory.format[game.id]);
  const format = chosen ?? (loaded ? defaultFormat(loaded) : 'any');
  const ev = useMemo(() => (loaded ? evaluatorFor(loaded, format) : loaded), [loaded, format]);
  const [avoidOthers, setAvoidOthers] = useState(false);
  const [building, setBuilding] = useState(false);
  const [result, setResult] = useState<BuildResult | null>(null);
  const [varied, setVaried] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [play, setPlay] = useState<PlaySummary | null>(null);
  const [tuning, setTuning] = useState<{ round: number; swaps: number } | null>(null);
  const [tuned, setTuned] = useState<{ swaps: string[]; before: PlaySummary } | null>(null);

  const formats = useMemo(() => (loaded ? formatsOf(loaded) : []), [loaded]);
  const options = useMemo<BuildOptions>(() => ({ source, collection, format }), [source, collection, format]);
  const getPool = usePool(ev, options);
  // Ideas need the whole pool read, which takes a moment on a big catalog, so they arrive after the first paint.
  // They come from the user's own cards when the source prefers them and they own enough to choose from.
  const [ideas, setIdeas] = useState<{ cards: CatalogCard[]; fromOwned: boolean; poolSize: number } | null>(null);
  useEffect(() => {
    if (!ev) return;
    setIdeas(null);
    const t = window.setTimeout(() => {
      const pool = getPool();
      const owned = source === 'catalog' ? [] : pool.filter((c) => (collection.get(c.id)?.qty ?? 0) > 0);
      const fromOwned = source === 'collection' || owned.length >= 20;
      setIdeas({ cards: seedIdeas(ev, fromOwned ? owned : pool, 8), fromOwned, poolSize: pool.length });
    }, 30);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ev, options]);
  const results = useMemo(() => (query.trim() ? searchCards(index, query, {}, collection, 12).cards : []), [index, query, collection]);

  // A different start or different rules make the last deck stale.
  useEffect(() => {
    setResult(null);
    setVaried(new Set());
    setPlay(null);
    setTuned(null);
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
      const built = buildDeck(
        ev,
        seeds.map((c) => c.id),
        opts,
        ev.pool(opts),
      );
      setResult(built);
      setTuned(null);
      setPlay(ev.playtest ? ev.playtest(built.cards, { games: PLAY_GAMES, seed: 1 }) : null);
      setBuilding(false);
    }, 60);
  };
  // Tuning plays the deck thousands of times; one round per timer tick keeps the page alive and shows progress.
  const tune = () => {
    if (!ev || !result || !canTune(ev) || !play) return;
    const avoid = new Set(varied);
    if (avoidOthers) for (const n of namesInDecks(ev, decks)) avoid.add(n);
    for (const s of seeds) avoid.delete(s.name);
    const opts = { ...options, avoid, keep: new Set(seeds.map((c) => c.name)) };
    const tunePool = ev.pool(opts);
    const before = play;
    const step = (state: TuneState) => {
      if (state.done || state.round >= TUNE_ROUNDS) {
        const score = ev.score(state.cards);
        setResult({ ...result, cards: state.cards, score });
        setPlay(ev.playtest!(state.cards, { games: PLAY_GAMES, seed: 1 }));
        setTuned({ swaps: state.steps.map((s) => `${s.out.name} → ${s.in.name}`), before });
        setTuning(null);
        return;
      }
      setTuning({ round: state.round + 1, swaps: state.steps.length });
      window.setTimeout(() => step(tuneRound(ev, state, opts, tunePool)), 30);
    };
    setTuning({ round: 1, swaps: 0 });
    window.setTimeout(() => step(tuneStart(result.cards)), 30);
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

  const summary = result ? summarizeDeck(result.cards, collection, claims) : null;

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
            {!ideas && <p className="deck-hint">Looking through the cards…</p>}
            {ideas && seeds.length < MAX_SEEDS && ideas.cards.length > 0 && !query.trim() && (
              <>
                <h3 className="advisor-sub">{ideas.fromOwned ? 'Ideas from your cards' : 'Ideas'}</h3>
                <div className="chip-row inline build-ideas">
                  {ideas.cards
                    .filter((c) => !seeds.some((s) => s.name === c.name))
                    .map((c) => (
                      <button key={c.id} type="button" className="chip" onClick={() => addSeed(c)}>
                        {c.name}
                      </button>
                    ))}
                </div>
              </>
            )}
            {source === 'collection' && ideas?.poolSize === 0 && (
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
            {play && (
              <>
                <h3 className="advisor-sub">Playtest</h3>
                <PlayLines play={play} />
                {tuned && (
                  <p className="deck-hint">
                    {tuned.swaps.length
                      ? `Tuned by playing, ${tuned.swaps.length} ${tuned.swaps.length === 1 ? 'swap' : 'swaps'}: ${tuned.swaps.join(', ')}. Before: ${tuned.before.lines[0].toLowerCase()}.`
                      : 'Tuning by playing found no swap that played better.'}
                  </p>
                )}
              </>
            )}
            <div className="deck-actions build-actions">
              <button type="button" className="btn primary" disabled={saving || !!tuning} onClick={() => void keep()}>
                Keep this deck
              </button>
              {play && canTune(ev) && (
                <button type="button" className="btn" disabled={!!tuning || building} onClick={tune}>
                  {tuning ? `Playing… round ${tuning.round} of ${TUNE_ROUNDS}, ${tuning.swaps} ${tuning.swaps === 1 ? 'swap' : 'swaps'}` : tuned ? 'Tune again' : 'Tune by playing'}
                </button>
              )}
              <button type="button" className="btn" disabled={building || !!tuning} onClick={another}>
                {building ? 'Building…' : 'Build another'}
              </button>
            </div>
            <PracticeBlock ev={ev} cards={result.cards} />
            <p className="deck-hint advisor-note">{SCORE_NOTE}</p>
          </section>
          <DeckSections game={game} cards={result.cards} index={index} collection={collection} claims={claims} />
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
