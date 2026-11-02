import { describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn(), getLaunchUrl: vi.fn() } }));

import { routeForUrl } from './deepLinks';

describe('routeForUrl', () => {
  it('opens a deck link on the import page and ignores anything else', () => {
    expect(routeForUrl('cardcodex://deck/CCD1.abcDEF123_-')).toBe('/decks/import/CCD1.abcDEF123_-');
    expect(routeForUrl('https://example.com/?x=CCD1.abcDEF123')).toBe('/decks/import/CCD1.abcDEF123');
    expect(routeForUrl('cardcodex://something')).toBeNull();
    expect(routeForUrl('')).toBeNull();
  });
});
