// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { firstBelow } from './pane';
import {
  currentArrival,
  measureScroll,
  noteNavigation,
  primeScrollMemory,
  resetScrollMemory,
  restoreScroll,
  settlePane,
} from './scroll-memory';

const HEADER = 120;
const ROW = 100;
const VIEW = 600;

/** A pane with a sticky header and `n` single-column rows, with the geometry jsdom does not compute. */
function makePane(n: number) {
  document.body.innerHTML = '';
  const pane = document.createElement('main');
  pane.id = 'main';
  const header = document.createElement('header');
  header.style.position = 'sticky';
  const grid = document.createElement('div');
  for (let i = 0; i < n; i++) {
    const a = document.createElement('a');
    a.textContent = `row ${i}`;
    grid.appendChild(a);
  }
  pane.append(header, grid);
  document.body.appendChild(pane);
  const maxScroll = Math.max(0, HEADER + n * ROW - VIEW);
  let scrollTop = 0;
  Object.defineProperty(pane, 'scrollTop', {
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = Math.max(0, Math.min(maxScroll, v));
    },
  });
  const rect = (top: number, height: number) =>
    ({ top, bottom: top + height, left: 0, right: 360, width: 360, height, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
  pane.getBoundingClientRect = () => rect(0, VIEW);
  header.getBoundingClientRect = () => rect(0, HEADER);
  grid.getBoundingClientRect = () => rect(HEADER - scrollTop, n * ROW);
  Array.from(grid.children).forEach((el, i) => {
    el.getBoundingClientRect = () => rect(HEADER + i * ROW - scrollTop, ROW);
  });
  return { pane, grid };
}

describe('pane geometry', () => {
  it('finds the row under the header by binary search', () => {
    const { pane, grid } = makePane(50);
    expect(firstBelow(grid.children, HEADER)).toBe(0);
    pane.scrollTop = 250; // row 1 ends at 120 + 200 - 250 = 70, above the line; row 2 ends at 170
    expect(firstBelow(grid.children, HEADER)).toBe(2);
    pane.scrollTop = 100000; // clamped to the end: the last rows
    expect(firstBelow(grid.children, HEADER)).toBe(45); // 480 px show rows 45–49 (row 44 ends at the line)
    expect(firstBelow(grid.children, 1e9)).toBe(-1);
  });
});

describe('scroll marks', () => {
  it('records the row under the header and puts a re-rendered page back under it', () => {
    const { pane } = makePane(50);
    pane.scrollTop = 250;
    const mark = measureScroll(pane);
    expect(mark).toEqual({ path: [1, 2], offset: 50, top: 250 });

    const again = makePane(50);
    expect(again.pane.scrollTop).toBe(0);
    restoreScroll(again.pane, mark);
    expect(again.pane.scrollTop).toBe(250);
  });

  it('falls back to the old scrollTop when the anchor no longer exists', () => {
    const { pane } = makePane(50);
    pane.scrollTop = 4000;
    const mark = measureScroll(pane);
    expect(mark.path).toEqual([1, 40]);
    const shorter = makePane(10);
    restoreScroll(shorter.pane, mark);
    expect(shorter.pane.scrollTop).toBe(HEADER + 10 * ROW - VIEW); // clamped
  });
});

describe('navigation memory', () => {
  beforeEach(() => {
    resetScrollMemory();
    window.history.replaceState(null, '', '#/dex');
  });

  it('starts at the top on a fresh page and comes back to where a revisited one was', () => {
    const { pane } = makePane(50);
    primeScrollMemory();
    expect(currentArrival()).toBe('same');
    const dexKey = (window.history.state as { key: string }).key;
    expect(typeof dexKey).toBe('string');

    // A tap on a tile: a new, untagged entry.
    pane.scrollTop = 250;
    window.history.pushState(null, '', '#/dex/25');
    noteNavigation(pane);
    expect(currentArrival()).toBe('fresh');
    expect((window.history.state as { key: string }).key).not.toBe(dexKey);
    const species = makePane(3);
    species.pane.scrollTop = 0;
    settlePane(species.pane);
    expect(currentArrival()).toBe('same');

    // Back: the Pokédex entry again, with its key in the state.
    window.history.pushState({ key: dexKey }, '', '#/dex');
    noteNavigation(species.pane);
    expect(currentArrival()).toBe('revisit');
    const dex = makePane(50);
    settlePane(dex.pane);
    expect(dex.pane.scrollTop).toBe(250);
    expect(currentArrival()).toBe('same');
  });

  it('leaves the pane alone when the same page rewrites its query, and starts over when its path changes', () => {
    const { pane } = makePane(50);
    primeScrollMemory();
    pane.scrollTop = 300;
    window.history.replaceState(window.history.state, '', '#/dex?q=pika');
    noteNavigation(pane);
    expect(currentArrival()).toBe('same');
    settlePane(pane);
    expect(pane.scrollTop).toBe(300);

    noteNavigation(pane); // nothing changed: no effect
    expect(currentArrival()).toBe('same');

    window.history.replaceState(window.history.state, '', '#/archetypes');
    noteNavigation(pane);
    expect(currentArrival()).toBe('fresh');
    settlePane(pane);
    expect(pane.scrollTop).toBe(0);
  });

  it('revisits without a mark start at the top', () => {
    const { pane } = makePane(50);
    primeScrollMemory();
    pane.scrollTop = 200;
    window.history.pushState({ key: 'never-seen' }, '', '#/sets');
    noteNavigation(pane);
    expect(currentArrival()).toBe('revisit');
    settlePane(pane);
    expect(pane.scrollTop).toBe(0);
  });
});
