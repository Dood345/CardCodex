/**
 * The deck check on the deck page: the recommender's score for the deck part
 * by part, the rule problems it sees, and what to do next — cards to add
 * while the deck is short, swaps once it is full — each with the reason and
 * one tap to apply. Where the game has a playtest simulator it also plays
 * the deck (how soon it attacks, how often it stalls), finds swaps by
 * playing, and deals practice hands. Closed until asked for, because opening
 * it loads the card texts. Games without an evaluator do not show it.
 */
import { useEffect, useMemo, useState } from 'react';
import { useCatalog, useGame } from '@/app/context';
import { useCollection } from '@/data/collection';
import type { Deck, DeckCard } from '@/data/db';
import { adjustDeckCard } from '@/data/decks';
import { cardImageUrl } from '@/data/types';
import { hasRecommender, loadEvaluator } from '@/recommend';
import { advise, defaultFormat, describeMove, evaluatorFor, formatDelta, formatsOf, SOURCES, type Advice } from '@/recommend/advice';
import { drawOne } from '@/recommend/practice';
import { canTune, tuneRound, tuneStart, type TuneStep } from '@/recommend/tune';
import type { BuildOptions, DeckEvaluator, DeckScore, FormatOption, PlaySummary, PracticeHand, Suggestion } from '@/recommend/types';
import { Chip, Img } from '@/ui/components';
import { href } from '@/ui/router';

/** Games behind the playtest numbers the screens show. */
export const PLAY_GAMES = 400;

/** The evaluator for the active catalog once `wanted` is true: undefined while loading, null when there is none or it failed. */
export function useEvaluator(wanted: boolean): { ev: DeckEvaluator | null | undefined; error: boolean } {
  const index = useCatalog();
  const [state, setState] = useState<{ ev: DeckEvaluator | null | undefined; error: boolean }>({ ev: undefined, error: false });
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    setState({ ev: undefined, error: false });
    loadEvaluator(index).then(
      (ev) => live && setState({ ev, error: false }),
      () => live && setState({ ev: null, error: true }),
    );
    return () => {
      live = false;
    };
  }, [index, wanted]);
  return state;
}

/** What the user last chose, kept while the app runs so the next deck opens the same way. */
export const advisorMemory: { open: boolean; source: BuildOptions['source']; format: Record<string, string> } = {
  open: false,
  source: 'prefer-collection',
  format: {},
};

/** The score as a number out of 100 and one bar per part with its one-line detail. */
export function ScoreParts({ score }: { score: DeckScore }) {
  return (
    <div className="advisor-parts">
      {score.parts.map((p) => (
        <div key={p.id} className="advisor-part">
          <div className="advisor-part-head">
            <span>{p.label}</span>
            <span className="advisor-part-pct">{Math.round(p.score * 100)}%</span>
          </div>
          <div className="progress-track" role="presentation">
            <div className={`progress-fill${p.score < 0.5 ? ' low' : ''}`} style={{ width: `${Math.round(p.score * 100)}%` }} />
          </div>
          <div className="advisor-detail">{p.detail}</div>
        </div>
      ))}
    </div>
  );
}

/** What playing the deck showed: the plan the test pilot followed and its findings. */
export function PlayLines({ play }: { play: PlaySummary }) {
  return (
    <div className="advisor-play">
      {play.plan && <div className="advisor-plan">Plays toward {play.plan}</div>}
      <ul>
        {play.lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <div className="advisor-detail">
        From {play.games} practice games against nobody, played by a simple test pilot.
      </div>
    </div>
  );
}

/** The source and format choices shared by the deck check and the Build-a-deck page. */
export function BuildChoices({
  source,
  onSource,
  formats,
  format,
  onFormat,
}: {
  source: BuildOptions['source'];
  onSource(s: BuildOptions['source']): void;
  formats: readonly FormatOption[];
  format: string;
  onFormat(f: string): void;
}) {
  return (
    <div className="advisor-choices">
      <div className="chip-row inline" role="group" aria-label="Where cards may come from">
        {SOURCES.map((s) => (
          <Chip key={s.id} active={source === s.id} onClick={() => onSource(s.id)}>
            {s.label}
          </Chip>
        ))}
      </div>
      {formats.length > 1 && (
        <div className="chip-row inline" role="group" aria-label="Format">
          {formats.map((f) => (
            <Chip key={f.id} active={format === f.id} onClick={() => onFormat(f.id)}>
              {f.label}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}

export const SCORE_NOTE =
  'The score reads the cards’ own text for rules of thumb. It knows nothing about tournament results, so treat it as a second opinion.';

/** A practice hand: deal, draw one more, look at what was set aside, deal again. */
export function PracticeBlock({ ev, cards }: { ev: DeckEvaluator; cards: readonly DeckCard[] }) {
  const index = useCatalog();
  // The hand belongs to the list it was dealt from: a changed deck list makes it meaningless, so it is dropped
  // by comparing lists here, not by an effect that could run after the first tap.
  const [dealt, setDealt] = useState<{ cards: readonly DeckCard[]; deal: PracticeHand } | null>(null);
  const [peek, setPeek] = useState(false);
  if (!ev.practice) return null;
  const deal = dealt && dealt.cards === cards ? dealt.deal : null;
  const setDeal = (d: PracticeHand) => setDealt({ cards, deal: d });
  const fresh = () => {
    setPeek(false);
    setDeal(ev.practice!(cards, Math.floor(Math.random() * 0x7fffffff)));
  };
  const row = (ids: readonly string[]) => (
    <div className="practice-hand">
      {ids.map((id, i) => {
        const card = index.cardsById.get(id);
        const set = card && index.setsById.get(card.set);
        return (
          <a key={`${id}-${i}`} className="practice-card" href={card ? href(`/card/${card.id}`) : undefined} title={card?.name}>
            {card && set ? <Img src={cardImageUrl(card, set.series, 'low')} alt={card.name} /> : null}
            <span>{card?.name ?? id}</span>
          </a>
        );
      })}
    </div>
  );
  return (
    <div className="advisor-practice">
      <h3 className="advisor-sub">Practice hand</h3>
      {deal && (
        <>
          {deal.note && <p className="deck-hint">{deal.note}</p>}
          {row(deal.hand)}
          {peek && deal.aside.length > 0 && (
            <>
              <div className="advisor-detail practice-aside">{deal.asideLabel}</div>
              {row(deal.aside)}
            </>
          )}
        </>
      )}
      <div className="deck-actions build-actions">
        <button type="button" className="btn" onClick={fresh}>
          {deal ? 'New hand' : 'Draw a hand'}
        </button>
        {deal && (
          <button type="button" className="btn" disabled={!deal.library.length} onClick={() => setDeal(drawOne(deal))}>
            Draw a card
          </button>
        )}
        {deal && deal.aside.length > 0 && (
          <button type="button" className="btn ghost" onClick={() => setPeek(!peek)}>
            {peek ? `Hide ${deal.asideLabel.toLowerCase()}` : `Show ${deal.asideLabel.toLowerCase()}`}
          </button>
        )}
      </div>
    </div>
  );
}

export function DeckAdvisor({ deck }: { deck: Deck }) {
  const game = useGame();
  const index = useCatalog();
  const collection = useCollection();
  const [open, setOpen] = useState(advisorMemory.open);
  const [source, setSource] = useState(advisorMemory.source);
  const { ev: loaded, error } = useEvaluator(open && hasRecommender(game.id));
  const formats = useMemo(() => (loaded ? formatsOf(loaded) : []), [loaded]);
  const [chosen, setFormat] = useState<string | undefined>(advisorMemory.format[game.id]);
  const format = chosen ?? (loaded ? defaultFormat(loaded) : 'any');
  const ev = useMemo(() => (loaded ? evaluatorFor(loaded, format) : loaded), [loaded, format]);
  const [advice, setAdvice] = useState<Advice | null>(null);
  const [play, setPlay] = useState<PlaySummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [trying, setTrying] = useState(false);
  const [played, setPlayed] = useState<{ step: TuneStep | null } | null>(null);

  const options = useMemo<BuildOptions>(() => ({ source, collection, format }), [source, collection, format]);
  const pool = useMemo(() => (ev ? ev.pool(options) : []), [ev, options]);

  // Scoring a deck is quick; a round of swaps is not instant on a phone, so it runs after the paint.
  useEffect(() => {
    if (!ev) return;
    setBusy(true);
    setPlayed(null);
    const t = window.setTimeout(() => {
      const a = advise(ev, deck.cards, options, pool);
      setAdvice(a);
      // Playing a deck means something once it is full.
      setPlay(ev.playtest && a.mode === 'swap' ? ev.playtest(deck.cards, { games: PLAY_GAMES, seed: 1 }) : null);
      setBusy(false);
    }, 30);
    return () => window.clearTimeout(t);
  }, [ev, deck.cards, options, pool]);

  if (!hasRecommender(game.id)) return null;

  const toggle = () => {
    advisorMemory.open = !open;
    setOpen(!open);
  };
  const apply = async (s: Suggestion) => {
    for (const c of s.move.remove) await adjustDeckCard(deck.id, c.id, -1);
    for (const c of s.move.add) await adjustDeckCard(deck.id, c.id, 1);
  };
  const tryByPlay = () => {
    if (!ev) return;
    setTrying(true);
    window.setTimeout(() => {
      const next = tuneRound(ev, tuneStart(deck.cards), { ...options, seed: Math.floor(Math.random() * 100000) }, pool);
      setPlayed({ step: next.steps[0] ?? null });
      setTrying(false);
    }, 40);
  };
  const applyPlayed = async (step: TuneStep) => {
    await adjustDeckCard(deck.id, step.out.id, -1);
    await adjustDeckCard(deck.id, step.in.id, 1);
  };

  return (
    <section className="deck-section advisor">
      <button type="button" className="advisor-head" aria-expanded={open} onClick={toggle}>
        <span className="advisor-title">Deck check</span>
        {open && advice ? (
          <span className="advisor-total">
            {Math.round(advice.score.total)}
            <small>/100</small>
          </span>
        ) : (
          <span className="advisor-open">{open ? '' : 'Score, playtest and suggestions'}</span>
        )}
        <span className={`advisor-chevron${open ? ' up' : ''}`} aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="advisor-body">
          {error && <p className="deck-hint">The card texts could not be loaded. Close and open the check to try again.</p>}
          {!error && ev === undefined && <p className="deck-hint">Reading the card texts…</p>}
          {ev && advice && (
            <>
              {advice.score.issues.length > 0 && (
                <ul className="advisor-issues">
                  {advice.score.issues.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              )}
              <ScoreParts score={advice.score} />
              {ev.playtest && (
                <>
                  <h3 className="advisor-sub">Playtest</h3>
                  {play ? <PlayLines play={play} /> : <p className="deck-hint">Playtest numbers appear once the deck is full.</p>}
                </>
              )}
              <h3 className="advisor-sub">{advice.mode === 'add' ? `Cards to add (${advice.main} of ${advice.target})` : 'Swaps that raise the score'}</h3>
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
              {advice.suggestions.length === 0 ? (
                <p className="deck-hint advisor-none">
                  {busy
                    ? 'Looking…'
                    : advice.mode === 'add'
                      ? source === 'collection'
                        ? 'Nothing you own would raise the score. Try “Prefer my cards”.'
                        : 'No card would raise the score right now.'
                      : 'No single swap raises the score.'}
                </p>
              ) : (
                <div className={`advisor-list${busy ? ' busy' : ''}`}>
                  {advice.suggestions.map((s) => {
                    const card = s.move.add[0];
                    const set = card && index.setsById.get(card.set);
                    const owned = card ? (collection.get(card.id)?.qty ?? 0) : 0;
                    return (
                      <div key={`${s.move.remove.map((c) => c.id).join()}>${s.move.add.map((c) => c.id).join()}`} className="advisor-row">
                        <a className="advisor-thumb" href={card ? href(`/card/${card.id}`) : undefined} aria-label={card ? `Open ${card.name}` : undefined}>
                          {card && set ? <Img src={cardImageUrl(card, set.series, 'low')} alt="" /> : null}
                        </a>
                        <div className="advisor-row-body">
                          <div className="cand-name">{describeMove(s)}</div>
                          <div className="cand-sub">{s.reason}</div>
                          <div className="cand-sub">{s.detail}</div>
                          <div className="cand-sub">{owned ? `You own ${owned}` : 'Not in your collection'}</div>
                        </div>
                        <div className="advisor-row-side">
                          <span className="advisor-delta">{formatDelta(s.delta)}</span>
                          <button type="button" className="btn" onClick={() => void apply(s)}>
                            {s.move.remove.length ? 'Swap' : 'Add'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {advice.mode === 'swap' && canTune(ev) && (
                <>
                  <h3 className="advisor-sub">Swaps found by playing</h3>
                  {played?.step && (
                    <div className="advisor-row">
                      <a className="advisor-thumb" href={href(`/card/${played.step.in.id}`)} aria-label={`Open ${played.step.in.name}`}>
                        {index.setsById.get(played.step.in.set) ? (
                          <Img src={cardImageUrl(played.step.in, index.setsById.get(played.step.in.set)!.series, 'low')} alt="" />
                        ) : null}
                      </a>
                      <div className="advisor-row-body">
                        <div className="cand-name">
                          Swap {played.step.out.name} for {played.step.in.name}
                        </div>
                        <div className="cand-sub">
                          Played better over 400 practice games: {Math.round(played.step.from)} → {Math.round(played.step.to)}
                        </div>
                        <div className="cand-sub">
                          {(collection.get(played.step.in.id)?.qty ?? 0) > 0 ? `You own ${collection.get(played.step.in.id)!.qty}` : 'Not in your collection'}
                        </div>
                      </div>
                      <div className="advisor-row-side">
                        <button type="button" className="btn" onClick={() => void applyPlayed(played.step!)}>
                          Swap
                        </button>
                      </div>
                    </div>
                  )}
                  {played && !played.step && <p className="deck-hint advisor-none">No swap played better this time.</p>}
                  <div className="deck-actions build-actions">
                    <button type="button" className="btn" disabled={trying} onClick={tryByPlay}>
                      {trying ? 'Playing…' : played ? 'Try again' : 'Find a swap by playing'}
                    </button>
                  </div>
                </>
              )}
              <PracticeBlock ev={ev} cards={deck.cards} />
              <p className="deck-hint advisor-note">{SCORE_NOTE}</p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
