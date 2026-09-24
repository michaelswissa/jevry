import { describe, expect, it } from 'vitest';
import { READ_STATE } from './snapshot';
import type { PageState } from './engine';

it('compiles the snapshot with rendered control names', () => {
  expect(() => new Function('return ' + READ_STATE)).not.toThrow();
});

describe.runIf(process.env.JEVRY_BROWSER_TEST === '1')('rendered control names', () => {
  it('excludes dormant warnings while preserving explicit accessible labels and visible nested text', async () => {
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch({ headless: true, executablePath: process.env.JEVRY_BROWSER_EXECUTABLE || undefined });
    try {
      const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
      await page.setContent(`<button id="report"><span hidden>HIDDEN_WARNING</span><span style="display:none">DISPLAY_WARNING</span>
        <span style="visibility:hidden">VISIBILITY_WARNING</span><span style="opacity:0">OPACITY_WARNING</span>
        <span aria-hidden="true">ARIA_WARNING</span><span inert>INERT_WARNING</span>
        <span style="display:contents"><strong>Monthly report</strong></span><script type="application/json">SCRIPT_WARNING</script></button>
        <span hidden id="accessible-name">Open saved report</span><button aria-labelledby="accessible-name">Icon</button>
        <label hidden for="search">Search reports</label><input id="search">
        <button aria-label="Download report">Icon</button>
        <name-widget></name-widget>
        <script>document.querySelector('name-widget').attachShadow({mode:'open'}).innerHTML='<button><span hidden>SHADOW_WARNING</span>Archive report</button>'</script>`);
      const before = await page.evaluate(() => ({ html: document.documentElement.outerHTML, x: scrollX, y: scrollY, w: innerWidth, h: innerHeight }));
      const state = await page.evaluate(READ_STATE) as PageState;
      const labels = state.actions.map(action => action.label.replace(/\s+/g, ' ').trim());
      expect(labels).toContain('Monthly report');
      expect(labels).toContain('Open saved report');
      expect(labels).toContain('Search reports');
      expect(labels).toContain('Download report');
      expect(labels).toContain('Archive report');
      expect(labels.join(' ')).not.toContain('_WARNING');
      expect(await page.evaluate(() => ({ html: document.documentElement.outerHTML, x: scrollX, y: scrollY, w: innerWidth, h: innerHeight }))).toEqual(before);
    } finally { await browser.close(); }
  }, 15000);
});
