/**
 * The deck check on the deck page: the recommender's score for the deck part
 * by part, the rule problems it sees, and what to do next — cards to add
 * while the deck is short, swaps once it is full — each with the reason and
 * one tap to apply. Closed until asked for, because opening it loads the
 * card texts. Games without an evaluator do not show it.
 */
import { useEffect, useMemo, useState } from 'react';
import { useCatalog, useGame } from '@/app/context';
import { useCollection } from '@/data/collection';
import type { Deck } from '@/data/db';
import { adjustDeckCard } from '@/data/decks';
import { cardImageUrl } from '@/data/types';
import { hasRecommender, loadEvaluator } from '@/recommend';
import { advise, describeMove, formatDelta, formatsOf, SOURCES, type Advice } from '@/recommend/advice';
import type { BuildOptions, DeckEvaluator, DeckScore, FormatOption, Suggestion } from '@/recommend/types';
import { Chip, Img } from '@/ui/components';
import { href } from '@/ui/router';

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

export function DeckAdvisor({ deck }: { deck: Deck }) {
  const game = useGame();
  const index = useCatalog();
  const collection = useCollection();
  const [open, setOpen] = useState(advisorMemory.open);
  const [source, setSource] = useState(advisorMemory.source);
  const { ev, error } = useEvaluator(open && hasRecommender(game.id));
  const formats = useMemo(() => (ev ? formatsOf(ev) : []), [ev]);
  const [format, setFormat] = useState(advisorMemory.format[game.id] ?? 'any');
  const [advice, setAdvice] = useState<Advice | null>(null);
  const [busy, setBusy] = useState(false);

  const options = useMemo<BuildOptions>(() => ({ source, collection, format }), [source, collection, format]);
  const pool = useMemo(() => (ev ? ev.pool(options) : []), [ev, options]);

  // Scoring a deck is quick; a round of swaps is not instant on a phone, so it runs after the paint.
  useEffect(() => {
    if (!ev) return;
    setBusy(true);
    const t = window.setTimeout(() => {
      setAdvice(advise(ev, deck.cards, options, pool));
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
          <span className="advisor-open">{open ? '' : 'Score and suggestions'}</span>
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
              <p className="deck-hint advisor-note">{SCORE_NOTE}</p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
