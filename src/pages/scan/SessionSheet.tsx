/**
 * "What have I added?" for the scanner: the list of cards added with the
 * scanner (this session's, or earlier ones from the scan log), each with the
 * owned count and a stepper to fix it; the pull-up bar under the camera view
 * that counts this session's adds; and the sheet the bar opens.
 */
import { useRef } from 'react';
import type { CollectionMap } from '@/data/collection';
import { formatCardNumber } from '@/data/catalog';
import { cardImageUrl } from '@/data/types';
import { QtyStepper, Sheet } from '@/ui/components';
import { href } from '@/ui/router';
import { sessionTotal, type SessionAdd } from './session-list';

/** Dragging up this far on the bar opens the sheet (a tap does too). */
const PULL_PX = 24;

/** One row per card: picture (opens the card), name, set and number, what was added, and the owned count to fix. */
export function SessionList({
  added,
  collection,
  mode,
}: {
  added: SessionAdd[];
  collection: CollectionMap;
  /** 'session': "+n this session"; 'log': earlier adds, counted from the scan log. */
  mode: 'session' | 'log';
}) {
  return (
    <div className="scan-candidates session-list">
      {added.map((e) => {
        const owned = collection.get(e.card.id)?.qty ?? 0;
        return (
          <div key={e.card.id} className="scan-candidate">
            <a href={href(`/card/${e.card.id}`)} aria-label={`Open ${e.card.name}`}>
              <img src={cardImageUrl(e.card, e.set.series, 'low')} alt="" />
            </a>
            <div className="cand-body">
              <div className="cand-name">{e.card.name}</div>
              <div className="cand-sub">
                {e.set.name} · {formatCardNumber(e.card, e.set)}
              </div>
              <div className="cand-sub">
                {mode === 'session' ? `+${e.qty} this session` : `added ${e.qty === 1 ? 'once' : `${e.qty} times`}`} · own {owned}
              </div>
            </div>
            <QtyStepper cardId={e.card.id} qty={owned} size="sm" />
          </div>
        );
      })}
    </div>
  );
}

export function SessionBar({ added, onOpen }: { added: SessionAdd[]; onOpen: () => void }) {
  const startY = useRef<number | null>(null);
  const total = sessionTotal(added);
  return (
    <button
      type="button"
      className="scan-session-bar"
      onClick={onOpen}
      onPointerDown={(e) => {
        startY.current = e.clientY;
      }}
      onPointerMove={(e) => {
        if (startY.current !== null && startY.current - e.clientY > PULL_PX) {
          startY.current = null;
          onOpen();
        }
      }}
      onPointerUp={() => {
        startY.current = null;
      }}
      onPointerCancel={() => {
        startY.current = null;
      }}
      aria-label="Cards added this session"
    >
      <span className="session-handle" aria-hidden="true" />
      <span className="session-text">
        {total} {total === 1 ? 'card' : 'cards'} this session
        {added.length !== total ? ` · ${added.length} different` : ''}
      </span>
      <span className="session-chevron" aria-hidden="true">
        ▲
      </span>
    </button>
  );
}

export function SessionSheet({
  open,
  added,
  collection,
  onClose,
  onClear,
}: {
  open: boolean;
  added: SessionAdd[];
  collection: CollectionMap;
  onClose: () => void;
  onClear: () => void;
}) {
  const total = sessionTotal(added);
  return (
    <Sheet open={open} onClose={onClose} title={`This session · ${total} ${total === 1 ? 'card' : 'cards'}`}>
      {added.length === 0 ? <p>Nothing added yet.</p> : <SessionList added={added} collection={collection} mode="session" />}
      <div className="sheet-actions">
        <button type="button" className="btn ghost" onClick={onClear} disabled={added.length === 0}>
          Clear list
        </button>
        <button type="button" className="btn primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Sheet>
  );
}
