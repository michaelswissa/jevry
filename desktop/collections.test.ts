import { describe, expect, it } from 'vitest';
import type { Page } from '@playwright/test';
import { READ_RENDERED_COLLECTIONS, type ObservedCollection } from './collections';

it('compiles the collection reader without requiring a browser or application state', () => {
  expect(() => new Function('elements', 'visible', 'closest', 'return ' + READ_RENDERED_COLLECTIONS)).not.toThrow();
});

type Read = () => Promise<ObservedCollection[]>;
async function fixture(html: string, check: (read: Read, page: Page) => Promise<void>) {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.JEVRY_BROWSER_EXECUTABLE || undefined });
  try {
    const context = await browser.newContext({ viewport: { width: 1000, height: 600 } });
    const page = await context.newPage();
    await page.route('**/*', route => route.abort());
    await page.setContent('<style>body{margin:0;font:16px sans-serif}li,article{min-height:35px}</style>' + html);
    const session = await context.newCDPSession(page);
    const { frameTree } = await session.send('Page.getFrameTree');
    const { executionContextId } = await session.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'jevry-collection-evidence-test' });
    const read: Read = async () => {
      const before = await page.evaluate(() => ({ x: scrollX, y: scrollY, w: innerWidth, h: innerHeight, html: document.documentElement.outerHTML }));
      const expression = `(() => {
        const elements=[...document.querySelectorAll('*')];
        const closest=(e,s)=>e?.closest(s)||null;
        const visible=e=>!closest(e,'[aria-hidden="true"],[inert]')&&e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});
        return ${READ_RENDERED_COLLECTIONS};
      })()`;
      const result = await session.send('Runtime.evaluate', { expression, contextId: executionContextId, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      const after = await page.evaluate(() => ({ x: scrollX, y: scrollY, w: innerWidth, h: innerHeight, html: document.documentElement.outerHTML }));
      expect(after).toEqual(before);
      const collections = result.result.value as ObservedCollection[];
      expect(collections.length).toBeLessThanOrEqual(4);
      expect(collections.reduce((sum, item) => sum + item.items.length, 0)).toBeLessThanOrEqual(50);
      expect(JSON.stringify(collections).length).toBeLessThanOrEqual(10000);
      for (const collection of collections) expect(collection.itemOrdinals).toHaveLength(collection.items.length);
      return collections;
    };
    await check(read, page);
  } finally { await browser.close(); }
}

// Deferred while a live evaluation runs. No model calls; disposable fixtures only.
describe.runIf(process.env.JEVRY_BROWSER_TEST === '1')('rendered collections in native Chromium', () => {
  it('reads whole offviewport records including names at their ends, excluding hidden items and site chrome', async () => {
    await fixture(`<header><ul><li>HEADER_SECRET</li></ul></header><nav><ul><li>NAV_SECRET</li></ul></nav>
      <aside><ol><li>ASIDE_SECRET</li></ol></aside><main><h2>Customer experiences</h2><ol id="experiences">
      ${Array.from({ length: 12 }, (_, i) => `<li><h3>Experience ${i + 1}</h3><p>${'Useful rendered content. '.repeat(12)}</p><p>Written by Person ${i + 1}</p><span hidden>HIDDEN_SECRET</span></li>`).join('')}
      <li hidden>ITEM_SECRET</li><li style="display:none">CSS_SECRET</li></ol></main><footer><ul><li>FOOTER_SECRET</li></ul></footer>`, async read => {
      const collections = await read(); expect(collections).toHaveLength(1);
      const c = collections[0]; expect(c.label).toBe('Customer experiences'); expect(c.totalItems).toBe(12); expect(c.totalDomItems).toBe(14);
      expect(c.items).toHaveLength(12); expect(c.truncated).toBe(false); expect(c.items.at(-1)).toMatch(/Written by Person 12$/);
      expect(JSON.stringify(c)).not.toContain('_SECRET');
    });
  }, 15000);

  it('retains article-local title/author metadata and counts nested article text only once', async () => {
    await fixture(`<main aria-label="Discussion"><article><header><h2>Article one</h2><p>Author Alpha at noon</p></header><p>Body one</p>
      <nav><ul><li><a href="#">NAV_ACTION_SECRET</a></li></ul></nav><div><article><header>Author Beta</header><p>Reply body unique</p></article></div>
      <footer>Published yesterday</footer></article><article><header>Article two by Gamma</header><p>Body two</p></article></main>`, async read => {
      const collections = await read(); expect(collections).toHaveLength(1); const c = collections[0]; expect(c.items).toHaveLength(3);
      expect(c.items[0]).toContain('Author Alpha at noon'); expect(c.items[0]).toContain('Published yesterday');
      expect(c.items[0]).not.toContain('Reply body unique'); expect(c.items[1]).toContain('Reply body unique'); expect(JSON.stringify(c)).not.toContain('_SECRET');
    });
  }, 15000);

  it('excludes menus, tabs, link-only navigation lists and nested list duplicates', async () => {
    await fixture(`<ul role="menu"><li>MENU_SECRET</li></ul><ul role="tablist"><li>TAB_SECRET</li></ul>
      <ul><li><a href="/one">LINK_SECRET</a></li><li><a href="/two">LINK_TWO_SECRET</a></li></ul>
      <main><h2>Facts</h2><ul><li>Fact A<ul><li>Nested fact B</li></ul></li><li>Fact C</li></ul></main>`, async read => {
      const collections = await read(); expect(collections).toHaveLength(1); expect(collections[0].items).toHaveLength(2);
      expect(collections[0].items[0]).toContain('Nested fact B'); expect(JSON.stringify(collections)).not.toContain('_SECRET');
    });
  }, 15000);

  it.each(['div', 'ul'])('reads a visible tabpanel nested in a %s tablist while excluding tab chrome', async wrapper => {
    const content = `<div role="tabpanel" aria-labelledby="active-tab">
      <h2>Reader experiences</h2><ol id="panel-records">
        <li><h3>First experience</h3><p>Useful public detail.</p>
          <div role="tablist"><ul><li><a role="tab" href="#nested-panel">NESTED_TAB_SECRET</a></li></ul></div>
          <p>Written by Alpha</p></li>
        <li><h3>Second experience</h3><p>Written by Beta</p></li>
      </ol>
      <div role="tablist"><ul><li><a role="tab" href="#">TAB_HEADER_SECRET</a></li></ul></div>
      <section><article><header>Public title by Gamma</header><p>Public article detail.</p><footer>Published today</footer></article></section>
      <nav><ul><li>NAV_SECRET</li></ul></nav><aside><ol><li>ASIDE_SECRET</li></ol></aside>
      <header><ul><li>HEADER_SECRET</li></ul></header><footer><ul><li>FOOTER_SECRET</li></ul></footer>
    </div><div role="tabpanel" hidden><ol><li>HIDDEN_PANEL_SECRET</li></ol></div>
      <div role="tabpanel" aria-hidden="true"><ol><li>ARIA_PANEL_SECRET</li></ol></div>
      <div role="tabpanel" inert><ol><li>INERT_PANEL_SECRET</li></ol></div>`;
    const header = wrapper === 'ul' ? 'li' : 'div';
    await fixture(`<main><${wrapper} role="tablist"><${header} role="presentation"><a id="active-tab" role="tab" aria-selected="true">Selected tab</a></${header}>
      ${wrapper === 'ul' ? '<li role="presentation">' + content + '</li>' : content}</${wrapper}></main>`, async read => {
      const collections = await read(); expect(collections).toHaveLength(2);
      const records = collections.find(collection => collection.source.id === 'panel-records')!;
      expect(records.items).toEqual(['First experience Useful public detail. Written by Alpha', 'Second experience Written by Beta']);
      expect(records.itemOrdinals).toEqual([1, 2]); expect(records.totalItems).toBe(2); expect(records.truncated).toBe(false);
      expect(collections.flatMap(collection => collection.items)).toContain('Public title by Gamma Public article detail. Published today');
      expect(JSON.stringify(collections)).not.toContain('_SECRET');
    });
  }, 15000);

  it('excludes hidden descendant content rather than copying innerText indiscriminately', async () => {
    await fixture(`<main><ol><li>Public record <span style="opacity:0">OPACITY_SECRET</span><span aria-hidden="true">ARIA_SECRET</span>
      <span style="visibility:hidden">VISIBILITY_SECRET</span><script type="application/json">{"body":"SCRIPT_SECRET"}</script>
      <textarea>EDITABLE_SECRET</textarea><span inert>INERT_SECRET</span><strong>Author End</strong></li></ol></main>`, async read => {
      const collections = await read(); expect(collections[0].items).toEqual(['Public record Author End']);
      expect(JSON.stringify(collections)).not.toContain('_SECRET');
    });
  }, 15000);

  it('returns a contiguous viewport-relative window with source ordinals on oversized collections', async () => {
    await fixture(`<main><ol id="long-list">${Array.from({ length: 100 }, (_, i) => `<li style="height:70px">Record ${i + 1}: ${'x'.repeat(170)}</li>`).join('')}</ol></main>`, async (read, page) => {
      const top = await read(); expect(top[0].totalItems).toBe(100); expect(top[0].truncated).toBe(true); expect(top[0].itemOrdinals[0]).toBe(1);
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      const bottom = await read(); expect(bottom[0].source.id).toBe('long-list'); expect(bottom[0].totalItems).toBe(100);
      expect(bottom[0].itemOrdinals[0]).toBeGreaterThan(top[0].itemOrdinals.at(-1)!); expect(bottom[0].itemOrdinals.at(-1)).toBe(100); expect(bottom[0].truncated).toBe(true);
    });
  }, 15000);

  it('marks partial oversized items explicitly instead of implying complete evidence', async () => {
    await fixture(`<main><ul><li>${'A long sentence. '.repeat(1200)} Author at end</li></ul></main>`, async read => {
      const collections = await read(); expect(collections).toHaveLength(1); expect(collections[0].truncated).toBe(true); expect(collections[0].partialItemOrdinals).toEqual([1]);
    });
  }, 15000);

  it('preserves distinct source records with identical text', async () => {
    await fixture('<main><ol><li>Same record text</li><li>Same record text</li></ol></main>', async read => {
      const collections = await read(); expect(collections[0].items).toEqual(['Same record text', 'Same record text']); expect(collections[0].itemOrdinals).toEqual([1, 2]);
    });
  }, 15000);

  it('keeps hidden article positions in source ordinals without exposing their text', async () => {
    await fixture('<main><article>First public item</article><article hidden>HIDDEN_SECRET</article><article>Third public item</article></main>', async read => {
      const collections = await read(); expect(collections[0].items).toEqual(['First public item', 'Third public item']);
      expect(collections[0].itemOrdinals).toEqual([1, 3]); expect(collections[0].totalItems).toBe(2); expect(collections[0].totalDomItems).toBe(3);
      expect(collections[0].truncated).toBe(false);
    });
  }, 15000);

  it('reports collection coverage while respecting global record and character budgets', async () => {
    await fixture(`<main>${Array.from({ length: 8 }, (_, i) => `<section><h2>Section ${i + 1}</h2><ul>${Array.from({ length: 20 }, (_, n) => `<li>Entry ${i + 1}/${n + 1}</li>`).join('')}</ul></section>`).join('')}</main>`, async read => {
      const collections = await read(); expect(collections.length).toBeLessThanOrEqual(4); expect(collections[0].source.collectionCount).toBe(8);
    });
  }, 15000);
});
