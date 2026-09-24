import { describe, expect, it } from 'vitest';
import type { Page } from '@playwright/test';
import type { PageState } from './engine';
import { READ_STATE } from './snapshot';

it('compiles the surface geometry reader with the ordinary snapshot', () => {
  expect(() => new Function('return ' + READ_STATE)).not.toThrow();
});

type Read = <T>(expression: string) => Promise<T>;
type Rect = { x: number; y: number; width: number; height: number };
const attr = (html: string) => html.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const canvas = (style = 'left:23px;top:31px;width:300px;height:200px') =>
  '<style>body{margin:0}</style><canvas aria-label="Strategy map" style="position:absolute;background:green;' + style + '"></canvas>';
const frame = (html: string, style = 'left:100px;top:80px;width:500px;height:350px;border:7px solid black', extra = '') =>
  '<iframe ' + extra + ' style="position:absolute;' + style + '" srcdoc="' + attr(html) + '"></iframe>';
const readSurface = `(() => {const c=window.__jevFast;const e=c.query('canvas')[0];return c.surfaceRect(e);})()`;
const retainSurface = `window.retainedSurface=window.__jevFast.query('canvas')[0];true`;
const retainedRect = `window.__jevFast.surfaceRect(window.retainedSurface)`;

async function fixture(html: string, check: (read: Read, page: Page) => Promise<void>) {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.JEVRY_BROWSER_EXECUTABLE || undefined });
  try {
    const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
    const page = await context.newPage();
    await page.route('**/*', route => route.abort());
    await page.setContent('<style>html,body{margin:0}</style>' + html);
    const session = await context.newCDPSession(page);
    const { frameTree } = await session.send('Page.getFrameTree');
    const { executionContextId } = await session.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'jevry-game-surfaces-test' });
    const read: Read = async expression => {
      const result = await session.send('Runtime.evaluate', { expression, contextId: executionContextId, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    await read(READ_STATE);
    await check(read, page);
  } finally { await browser.close(); }
}

describe.runIf(process.env.JEVRY_BROWSER_TEST === '1')('guarded game surface geometry in native Chromium', () => {
  it('keeps a top-level board geometry and DOM unchanged', async () => {
    await fixture(canvas('left:45px;top:35px;width:320px;height:180px'), async (read, page) => {
      const before = await page.evaluate(() => ({ html: document.documentElement.outerHTML, x: scrollX, y: scrollY, w: innerWidth, h: innerHeight }));
      expect(await read<Rect>(readSurface)).toEqual({ x: 45, y: 35, width: 320, height: 180 });
      const state = await read<PageState>(READ_STATE);
      expect(state.actions.some(action => action.kind === 'point' && action.role === 'canvas')).toBe(true);
      expect(await page.evaluate(() => ({ html: document.documentElement.outerHTML, x: scrollX, y: scrollY, w: innerWidth, h: innerHeight }))).toEqual(before);
    });
  }, 15000);

  it('maps a same-origin frame through offset and border pixels', async () => {
    await fixture(frame(canvas()), async read => {
      expect(await read<Rect>(readSurface)).toEqual({ x: 130, y: 118, width: 300, height: 200 });
      expect(await read(`window.__jevFast.point(window.__jevFast.query('canvas')[0],{x:.5,y:.5})`)).toEqual({ x: 280, y: 218 });
      expect((await read<PageState>(READ_STATE)).actions.filter(action => action.kind === 'point')).toHaveLength(1);
    });
  }, 15000);

  it('composes nested frame borders and offsets into top viewport coordinates', async () => {
    const nested = '<style>body{margin:0}</style>' + frame(canvas('left:17px;top:11px;width:260px;height:170px'), 'left:40px;top:30px;width:350px;height:240px;border:3px solid black');
    await fixture(frame(nested, 'left:90px;top:60px;width:500px;height:360px;border:5px solid black'), async read => {
      expect(await read<Rect>(readSurface)).toEqual({ x: 155, y: 109, width: 260, height: 170 });
      expect(await read(`window.__jevFast.point(window.__jevFast.query('canvas')[0],{x:.5,y:.5})`)).toEqual({ x: 285, y: 194 });
    });
  }, 15000);

  it('uses current inner-document scroll without renormalizing a clipped board', async () => {
    const child = canvas('left:-50px;top:170px;width:400px;height:260px') + '<div style="height:900px"></div>';
    await fixture(frame(child, 'left:75px;top:65px;width:300px;height:200px;border:5px solid black'), async (read, page) => {
      await page.evaluate(() => document.querySelector('iframe')!.contentWindow!.scrollTo(0, 200));
      await read(READ_STATE);
      expect(await read<Rect>(readSurface)).toEqual({ x: 30, y: 40, width: 400, height: 260 });
      expect(await read(`window.__jevFast.point(window.__jevFast.query('canvas')[0],{x:.01,y:.5})`)).toBeNull();
      expect(await read(`window.__jevFast.point(window.__jevFast.query('canvas')[0],{x:.5,y:.5})`)).toEqual({ x: 230, y: 170 });
    });
  }, 15000);

  it('rejects covered surfaces and individually covered positions while retaining an exposed full board', async () => {
    await fixture(frame(canvas()), async (read, page) => {
      await read(retainSurface);
      await page.evaluate(() => {
        const overlay = document.createElement('button'); overlay.id = 'cover';
        overlay.style.cssText = 'position:fixed;left:250px;top:188px;width:60px;height:60px;z-index:10';
        document.body.append(overlay);
      });
      expect(await read<Rect>(retainedRect)).toEqual({ x: 130, y: 118, width: 300, height: 200 });
      expect(await read(`window.__jevFast.point(window.retainedSurface,{x:.5,y:.5})`)).toBeNull();
      await page.evaluate(() => { document.getElementById('cover')!.style.cssText = 'position:fixed;inset:0;z-index:10'; });
      expect(await read(retainedRect)).toBeNull();
      expect((await read<PageState>(READ_STATE)).actions.some(action => action.kind === 'point')).toBe(false);
    });
  }, 15000);

  it.each(['transform:scale(1.1)', 'rotate:1deg', 'zoom:1.2', 'padding:2px'])('rejects unsupported frame mapping after %s', async style => {
    await fixture(frame(canvas()), async (read, page) => {
      await read(retainSurface);
      await page.evaluate(value => { document.querySelector('iframe')!.style.cssText += ';' + value; }, style);
      expect(await read(retainedRect)).toBeNull();
      const state = await read<PageState>(READ_STATE);
      expect(state.actions.some(action => action.kind === 'point')).toBe(false);
      expect(state.unsupported_frames).toBeGreaterThan(0);
    });
  }, 15000);

  it.each(['hidden', 'inert', 'aria-hidden', 'opacity'])('rejects a hidden or inert frame using %s', async mode => {
    await fixture(frame(canvas()), async (read, page) => {
      await read(retainSurface);
      await page.evaluate(value => {
        const element = document.querySelector('iframe')!;
        if (value === 'opacity') element.style.opacity = '0';
        else element.setAttribute(value, value === 'aria-hidden' ? 'true' : '');
      }, mode);
      expect(await read(retainedRect)).toBeNull();
      expect((await read<PageState>(READ_STATE)).actions.some(action => action.kind === 'point')).toBe(false);
    });
  }, 15000);

  it('rejects a hidden canvas in an otherwise supported frame', async () => {
    await fixture(frame(canvas()), async (read, page) => {
      await read(retainSurface);
      await page.evaluate(() => { document.querySelector('iframe')!.contentDocument!.querySelector('canvas')!.hidden = true; });
      expect(await read(retainedRect)).toBeNull();
    });
  }, 15000);

  it('rejects an old document after its iframe navigates and clears stale observed nodes', async () => {
    await fixture(frame(canvas()), async (read, page) => {
      await read(retainSurface);
      const oldNode = (await read<PageState>(READ_STATE)).actions.find(action => action.kind === 'point')!.node!;
      await page.evaluate(html => { document.querySelector('iframe')!.srcdoc = html; }, canvas('left:20px;top:20px;width:200px;height:150px') + '<span id="replacement"></span>');
      await page.waitForFunction(() => !!document.querySelector('iframe')!.contentDocument?.getElementById('replacement'));
      expect(await read(retainedRect)).toBeNull();
      const state = await read<PageState>(READ_STATE);
      expect(state.actions.find(action => action.kind === 'point')?.node).not.toBe(oldNode);
      expect(await read(`window.__jevFast.nodes.has(${oldNode})`)).toBe(false);
      expect(await read<Rect>(readSurface)).toEqual({ x: 127, y: 107, width: 200, height: 150 });
    });
  }, 15000);

  it('rejects a detached iframe even while an old surface reference remains', async () => {
    await fixture(frame(canvas()), async (read, page) => {
      await read(retainSurface);
      await page.evaluate(() => document.querySelector('iframe')!.remove());
      expect(await read(retainedRect)).toBeNull();
    });
  }, 15000);

  it('does not expose surfaces in an opaque cross-origin frame', async () => {
    await fixture(frame(canvas(), undefined, 'sandbox'), async read => {
      const state = await read<PageState>(READ_STATE);
      expect(state.actions.some(action => action.kind === 'point')).toBe(false);
      expect(state.unsupported_frames).toBeGreaterThan(0);
      expect(await read(readSurface)).toBeNull();
    });
  }, 15000);
});
