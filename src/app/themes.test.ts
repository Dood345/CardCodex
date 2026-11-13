/** The accent colours and the true black background: the stylesheet and themes.ts agree, and every accent reads on every background. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACCENTS, applyAppearance, contrast, DEFAULT_ACCENT, isAccentId, PAGE_BG } from './themes';

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
/** The declarations of the first rule whose selector is exactly `selector`. */
const rule = (selector: string): Record<string, string> => {
  const at = css.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  const body = css.slice(at + selector.length + 2, css.indexOf('}', at));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].replace(/\/\*.*\*\//, '').trim()]));
};

describe('accent colours', () => {
  it('are the ones the stylesheet applies', () => {
    expect(new Set(ACCENTS.map((a) => a.id)).size).toBe(ACCENTS.length);
    expect(DEFAULT_ACCENT).toBe('red');
    const root = rule(':root');
    expect([root['--accent'], root['--accent-strong'], root['--accent-fg']]).toEqual([ACCENTS[0].accent, ACCENTS[0].strong, ACCENTS[0].fg]);
    for (const a of ACCENTS.slice(1)) {
      const r = rule(`:root[data-accent='${a.id}']`);
      expect([r['--accent'], r['--accent-strong'], r['--accent-fg']], a.id).toEqual([a.accent, a.strong, a.fg]);
    }
    // And no accent in the stylesheet that the Settings screen does not offer.
    const inCss = [...css.matchAll(/:root\[data-accent='([a-z]+)'\]/g)].map((m) => m[1]);
    expect(new Set(inCss)).toEqual(new Set(ACCENTS.slice(1).map((a) => a.id)));
  });

  it('read on the dark, the black and the light background, and carry their own text', () => {
    const dark = rule(':root')['--bg-elev'];
    const light = rule(":root[data-theme='light']")['--bg-elev'];
    const black = rule(":root[data-black][data-theme='dark']")['--bg-elev'];
    for (const a of ACCENTS) {
      // The accent as a control or a label on a surface: 3 to 1 (WCAG 2, non-text contrast and large text).
      // The lighter shade is what the active tab is drawn in, so it is held to the same.
      for (const [name, bg] of [['dark', dark], ['light', light], ['black', black]] as const) {
        expect(contrast(a.accent, bg), `${a.id} on ${name}`).toBeGreaterThanOrEqual(3);
        expect(contrast(a.strong, bg), `${a.id}, lighter shade, on ${name}`).toBeGreaterThanOrEqual(3);
      }
      // The text on a button of that colour: at least what the red has always had (4.4 to 1).
      expect(contrast(a.fg, a.accent), `${a.id} text`).toBeGreaterThanOrEqual(4);
    }
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 5);
  });

  it('knows its own ids', () => {
    expect(isAccentId('blue')).toBe(true);
    expect(isAccentId('amber')).toBe(false);
    expect(isAccentId(undefined)).toBe(false);
  });
});

describe('true black', () => {
  it('is pure black, in the dark theme only, the same whether dark was chosen or the device asked for it', () => {
    const chosen = rule(":root[data-black][data-theme='dark']");
    expect(chosen['--bg']).toBe('#000000');
    const system = rule(':root[data-black]:not([data-theme])');
    expect(system).toEqual(chosen);
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\) \{\s*:root\[data-black\]:not\(\[data-theme\]\) \{/);
    // The light theme has no black variant.
    expect(css).not.toMatch(/data-black\]\[data-theme='light'\]/);
  });
});

describe('putting the appearance on the document', () => {
  const stub = () => {
    const attrs = new Map<string, string>();
    return { attrs, el: { setAttribute: (k: string, v: string) => void attrs.set(k, v), removeAttribute: (k: string) => void attrs.delete(k) } as unknown as HTMLElement };
  };
  it('sets what was chosen and clears what was not', () => {
    const root = stub();
    const meta = stub();
    applyAppearance({ theme: 'dark', accent: 'teal', trueBlack: true }, false, root.el, meta.el);
    expect(Object.fromEntries(root.attrs)).toEqual({ 'data-theme': 'dark', 'data-accent': 'teal', 'data-black': 'on' });
    expect(meta.attrs.get('content')).toBe(PAGE_BG.black);
    applyAppearance({ theme: 'system', accent: 'red', trueBlack: false }, true, root.el, meta.el);
    expect(Object.fromEntries(root.attrs)).toEqual({});
    expect(meta.attrs.get('content')).toBe(PAGE_BG.dark);
    // True black changes nothing in the light theme, and an unknown accent falls back to the default.
    applyAppearance({ theme: 'light', accent: 'nope', trueBlack: true }, true, root.el, meta.el);
    expect(root.attrs.has('data-accent')).toBe(false);
    expect(meta.attrs.get('content')).toBe(PAGE_BG.light);
    applyAppearance({ theme: 'system', accent: 'blue', trueBlack: true }, false, root.el, null);
    expect(root.attrs.get('data-accent')).toBe('blue');
  });
});
