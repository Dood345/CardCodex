/** Settings → Appearance: the accent colour and the true black background apply at once, last a reload, and stay out of the light theme. */
import assert from 'node:assert/strict';
import { openApp, overflowsSideways } from './lib/app.mjs';

const look = () => {
  const root = getComputedStyle(document.documentElement);
  const tab = document.querySelector('.bottom-nav .active, .bottom-nav [aria-current]');
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    accentAttr: document.documentElement.getAttribute('data-accent'),
    black: document.documentElement.getAttribute('data-black'),
    accent: root.getPropertyValue('--accent').trim(),
    bg: root.getPropertyValue('--bg').trim(),
    body: getComputedStyle(document.body).backgroundColor,
    tab: tab ? getComputedStyle(tab).color : null,
    meta: document.querySelector('meta[name="theme-color"]')?.getAttribute('content'),
    swatches: [...document.querySelectorAll('.swatch')].map((b) => `${b.getAttribute('aria-label')}${b.getAttribute('aria-checked') === 'true' ? '*' : ''}`),
  };
};
const chip = (label) => {
  const el = [...document.querySelectorAll('.settings-section .chip')].find((c) => c.textContent.trim() === label);
  if (el) el.click();
  return !!el;
};

export default [
  {
    name: 'an accent colour and true black apply at once and last a reload',
    async run({ page, base }) {
      await openApp(page, base, 'pokemon', '#/settings');
      await page.waitFor(() => document.querySelectorAll('.swatch').length >= 6, { what: 'the colour swatches' });
      const first = await page.run(look);
      assert.deepEqual(first.swatches, ['Red*', 'Blue', 'Green', 'Teal', 'Purple', 'Pink']);
      assert.equal(first.accent, '#e3350d');

      assert.equal(await page.run(chip, 'Dark'), true);
      await page.run(() => document.querySelector('.swatch[aria-label="Blue"]').click());
      const blue = await page.waitFor(() => document.documentElement.getAttribute('data-accent') === 'blue', { what: 'the blue accent' }).then(() => page.run(look));
      assert.equal(blue.accent, '#2563eb');
      assert.equal(blue.theme, 'dark');
      assert.equal(blue.bg, '#0f1115');
      assert.ok(blue.swatches.includes('Blue*') && blue.swatches.includes('Red'));

      // True black: the label's checkbox.
      await page.run(() => [...document.querySelectorAll('label.setting-row')].find((l) => l.textContent.includes('True black background')).querySelector('input').click());
      const black = await page.waitFor(() => document.documentElement.getAttribute('data-black') === 'on', { what: 'true black' }).then(() => page.run(look));
      assert.equal(black.bg, '#000000');
      assert.equal(black.body, 'rgb(0, 0, 0)');
      assert.equal(black.meta, '#000000');
      assert.equal(await page.run(overflowsSideways), false);

      // After a reload it is all still there, and another screen wears the colour.
      await page.run(() => {
        location.hash = '#/sets';
        location.reload();
      });
      await page.waitFor(() => document.querySelectorAll('.set-row').length > 20, { timeout: 60_000, what: 'the Sets page after the reload' });
      const again = await page.run(look);
      assert.equal(again.accent, '#2563eb');
      assert.equal(again.body, 'rgb(0, 0, 0)');
      assert.equal(again.tab, 'rgb(59, 130, 246)', 'the active tab is drawn in the lighter shade of the accent');
    },
  },
  {
    name: 'true black leaves the light theme alone, and red clears the accent',
    async run({ page, base }) {
      await openApp(page, base, 'ygo', '#/settings');
      await page.waitFor(() => document.querySelectorAll('.swatch').length >= 6, { what: 'the colour swatches' });
      await page.run(chip, 'Light');
      await page.run(() => [...document.querySelectorAll('label.setting-row')].find((l) => l.textContent.includes('True black background')).querySelector('input').click());
      await page.run(() => document.querySelector('.swatch[aria-label="Purple"]').click());
      const light = await page.waitFor(() => document.documentElement.getAttribute('data-accent') === 'purple', { what: 'the purple accent' }).then(() => page.run(look));
      assert.equal(light.theme, 'light');
      assert.equal(light.bg, '#f6f7fb');
      assert.equal(light.meta, '#f6f7fb');
      assert.equal(light.accent, '#8b5cf6');
      await page.run(() => document.querySelector('.swatch[aria-label="Red"]').click());
      await page.waitFor(() => !document.documentElement.hasAttribute('data-accent'), { what: 'the default accent' });
      assert.equal((await page.run(look)).accent, '#e3350d');
    },
  },
  {
    name: 'a long list with a quick scroll hides the pane\'s own scrollbar, and other screens keep it',
    async run({ page, base }) {
      await openApp(page, base, 'pokemon', '#/dex');
      await page.waitFor(() => !!document.querySelector('.quick-scroll'), { timeout: 30_000, what: 'the quick scroll on the Pokédex' });
      const pane = () => ({ cls: document.getElementById('main').classList.contains('has-quick-scroll'), width: getComputedStyle(document.getElementById('main')).scrollbarWidth });
      assert.deepEqual(await page.run(pane), { cls: true, width: 'none' });
      await page.run(() => {
        location.hash = '#/search';
      });
      await page.waitFor(() => !document.querySelector('.quick-scroll'), { what: 'the Search page' });
      assert.deepEqual(await page.run(pane), { cls: false, width: 'auto' });
    },
  },
];
