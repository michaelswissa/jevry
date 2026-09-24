import { EventEmitter } from 'node:events';
import type { HandlerDetails, WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { OwnedPageNavigation } from './owned-navigation';
import { READ_STATE } from './snapshot';
import type { BrowserAdapter } from './engine';

const origin = 'https://example.test';
const details = (url = origin + '/result', postBody?: HandlerDetails['postBody']) => ({ url, referrer: { url: origin + '/start', policy: 'strict-origin-when-cross-origin' as const }, postBody });
function fixture() {
  const controller = new AbortController();
  let current = origin + '/start';
  const contents = Object.assign(new EventEmitter(), {
    getURL: () => current,
    stop: vi.fn(),
    loadURL: vi.fn(async (url: string, _options?: Electron.LoadURLOptions) => { current = url; }),
  });
  const followed = vi.fn();
  const owner = new OwnedPageNavigation(contents as unknown as WebContents, { signal: controller.signal, allowedOrigins: [origin], followed });
  const browser: BrowserAdapter = {
    evaluate: vi.fn(async <T>() => current as T), cdp: vi.fn(async () => ({})),
    navigate: async url => { await contents.loadURL(url); }, url: () => current,
  };
  return { contents, controller, owner, followed, browser };
}

describe('turn-owned popup navigation', () => {
  it('waits until native dispatch finishes, follows once in the same contents, and preserves the referrer', async () => {
    const f = fixture(), wrapped = f.owner.wrap(f.browser);
    expect(f.owner.popup(details())).toEqual({ action: 'deny' });
    expect(f.contents.loadURL).not.toHaveBeenCalled();
    await wrapped.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased' });
    await wrapped.evaluate('/* jev:focused */ true');
    expect(f.contents.loadURL).not.toHaveBeenCalled();
    expect(await wrapped.evaluate('/* jev:settle */ true')).toBe(origin + '/result');
    expect(await wrapped.evaluate(READ_STATE)).toBe(origin + '/result');
    expect(f.contents.loadURL).toHaveBeenCalledExactlyOnceWith(origin + '/result', { httpReferrer: details().referrer });
    expect(f.followed).toHaveBeenCalledExactlyOnceWith(origin + '/result');
    expect(f.controller.signal.aborted).toBe(false);
    await f.owner.closeAndDrain();
  });

  it('reports an out-of-scope GET popup without abandoning the usable source page', async () => {
    const f = fixture();
    f.owner.popup(details('https://other.test/result?token=private'));
    expect(await f.owner.flush()).toBe(false);
    expect(f.owner.blockedReason).toBeUndefined();
    expect(f.owner.navigationFeedback()).toEqual([{ kind: 'origin_rejected', phase: 'popup', reason: 'outside_allowed_sites', origin: 'https://other.test' }]);
    expect(f.contents.loadURL).not.toHaveBeenCalled();
    expect(f.controller.signal.aborted).toBe(false);
    f.owner.popup(details());
    expect(await f.owner.flush()).toBe(true);
    expect(f.contents.loadURL).toHaveBeenCalledOnce();
    await f.owner.closeAndDrain();
  });

  it('suppresses only the exact source GET route after its off-site redirect, without replaying it', async () => {
    const f = fixture(), event = { preventDefault: vi.fn() };
    f.contents.loadURL.mockImplementationOnce(async () => {
      f.contents.emit('will-redirect', event, 'https://other.test/secret?token=private', false, true);
      throw new Error('ERR_ABORTED');
    });
    f.owner.popup(details(origin + '/redirect?report=1'));
    expect(await f.owner.flush()).toBe(false);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(f.owner.blockedReason).toBeUndefined();
    expect(f.owner.navigationFeedback()).toEqual([{ kind: 'origin_rejected', phase: 'redirect', reason: 'outside_allowed_sites', origin: 'https://other.test' }]);
    expect(f.owner.isRejectedNavigation(origin + '/start', '/redirect?report=1')).toBe(true);
    expect(f.owner.isRejectedNavigation(origin + '/start', '/redirect?report=2')).toBe(false);
    expect(f.owner.isRejectedNavigation(origin + '/different', '/redirect?report=1')).toBe(false);
    expect(f.owner.isRejectedNavigation(origin + '/start', '/local')).toBe(false);
    expect(await f.owner.flush()).toBe(false);
    expect(f.contents.loadURL).toHaveBeenCalledOnce();
    f.owner.popup(details(origin + '/local'));
    expect(await f.owner.flush()).toBe(true);
    await f.owner.closeAndDrain();
    expect(f.owner.navigationFeedback()).toEqual([]);
    expect(f.owner.isRejectedNavigation(origin + '/start', '/redirect?report=1')).toBe(false);
  });

  it('does not recover a denied GET if its original page has been replaced', async () => {
    const f = fixture();
    f.owner.popup(details('https://other.test/outside'));
    await f.contents.loadURL(origin + '/replacement');
    expect(await f.owner.flush()).toBe(false);
    expect(f.owner.blockedReason).toMatch(/replaced the source page/);
    await f.owner.closeAndDrain();
  });

  it('does not treat an unrelated page-initiated request as part of the proven popup GET chain', async () => {
    const f = fixture(), event = { preventDefault: vi.fn() };
    f.contents.loadURL.mockImplementationOnce(async () => {
      f.contents.emit('will-navigate', { preventDefault: vi.fn() }, origin + '/possibly-posted', false, true);
      f.contents.emit('will-redirect', event, 'https://other.test/private', false, true);
      throw new Error('ERR_ABORTED');
    });
    f.owner.popup(details());
    expect(await f.owner.flush()).toBe(false);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(f.owner.blockedReason).toMatch(/outside.*allowed sites/);
    expect(f.owner.navigationFeedback()).toEqual([]);
    expect(f.owner.isRejectedNavigation(origin + '/start', origin + '/result')).toBe(false);
    await f.owner.closeAndDrain();
  });

  it('bounds model feedback, retains full private URL equality, and expires both with the turn', async () => {
    const f = fixture(), wrapped = f.owner.wrap(f.browser);
    for (let i = 0; i < 10; i++) {
      f.owner.popup(details('https://other' + i + '.test/private?token=' + i));
      await f.owner.flush();
    }
    const feedback = wrapped.navigationFeedback!();
    expect(feedback).toHaveLength(6);
    expect(JSON.stringify(feedback)).not.toMatch(/private|token/);
    expect(wrapped.isRejectedNavigation!(origin + '/start', 'https://other0.test/private?token=0')).toBe(true);
    expect(wrapped.isRejectedNavigation!(origin + '/start', 'https://other0.test/private?token=1')).toBe(false);
    await f.owner.closeAndDrain();
    expect(wrapped.navigationFeedback!()).toEqual([]);
  });

  it.each(['will-navigate', 'will-redirect'])('enforces task scope on %s without pretending the user stopped', async kind => {
    const f = fixture(), event = { preventDefault: vi.fn() };
    f.contents.emit(kind, event, 'https://other.test/private');
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(f.owner.blockedReason).toMatch(/outside.*allowed sites/);
    expect(f.controller.signal.aborted).toBe(false);
    await f.owner.closeAndDrain();
    const manual = { preventDefault: vi.fn() };
    f.contents.emit(kind, manual, 'https://other.test/manual');
    expect(manual.preventDefault).not.toHaveBeenCalled();
  });

  it('never drops or replays a popup POST body as a GET', async () => {
    const f = fixture();
    f.owner.popup(details(origin + '/submit', { data: [{ bytes: Buffer.from('value=123') }], contentType: 'application/x-www-form-urlencoded', boundary: '' } as HandlerDetails['postBody']));
    expect(await f.owner.flush()).toBe(false);
    expect(f.owner.blockedReason).toMatch(/posted data was not replayed or replaced with a GET/);
    expect(f.contents.loadURL).not.toHaveBeenCalled();
    await f.owner.closeAndDrain();
  });

  it('cancels a queued popup without sending a request when Stop arrives before the read boundary', async () => {
    const f = fixture();
    f.owner.popup(details()); f.controller.abort(new Error('User stopped'));
    await expect(f.owner.flush()).rejects.toThrow('User stopped');
    expect(f.contents.loadURL).not.toHaveBeenCalled();
    expect(f.owner.popup(details())).toEqual({ action: 'deny' });
    await f.owner.closeAndDrain();
  });

  it('stops and drains an in-flight navigation on cancellation and never starts it again', async () => {
    const f = fixture();
    f.contents.loadURL.mockImplementation(() => new Promise<void>(() => {}));
    f.owner.popup(details());
    const loading = f.owner.flush();
    f.controller.abort(new Error('User stopped'));
    await expect(loading).rejects.toThrow('User stopped');
    expect(f.contents.stop).toHaveBeenCalledOnce();
    await f.owner.closeAndDrain();
    expect(f.contents.loadURL).toHaveBeenCalledOnce();
    expect(f.contents.listenerCount('dom-ready')).toBe(0);
    expect(f.contents.listenerCount('will-redirect')).toBe(0);
  });

  it('deduplicates a repeated popup and blocks conflicting destinations', async () => {
    const f = fixture();
    f.owner.popup(details()); f.owner.popup(details());
    await f.owner.flush();
    expect(f.contents.loadURL).toHaveBeenCalledOnce();
    f.owner.popup(details(origin + '/one')); f.owner.popup(details(origin + '/two'));
    expect(await f.owner.flush()).toBe(false);
    expect(f.owner.blockedReason).toMatch(/multiple destinations/);
    expect(f.contents.loadURL).toHaveBeenCalledOnce();
    await f.owner.closeAndDrain();
  });

  it('keeps conflicting destinations fatal even when the first popup was denied by origin', async () => {
    const f = fixture();
    f.owner.popup(details('https://other.test/outside'));
    f.owner.popup(details(origin + '/local'));
    expect(await f.owner.flush()).toBe(false);
    expect(f.owner.blockedReason).toMatch(/multiple destinations/);
    expect(f.contents.loadURL).not.toHaveBeenCalled();
    await f.owner.closeAndDrain();
  });

  it('keeps same-origin redirects and validates programmatic destinations', async () => {
    const f = fixture(), event = { preventDefault: vi.fn() };
    f.contents.emit('will-redirect', event, origin + '/redirected');
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(f.owner.assertAllowed(origin + '/initial')).toBe(origin + '/initial');
    await expect(f.owner.wrap(f.browser).navigate('https://other.test/page')).rejects.toThrow(/outside.*allowed sites/);
    expect(f.contents.loadURL).not.toHaveBeenCalled();
    await f.owner.closeAndDrain();
  });

  it('does not apply main-page scope to a third-party embedded-frame redirect', async () => {
    const f = fixture(), legacy = { preventDefault: vi.fn() }, current = { isMainFrame: false, preventDefault: vi.fn() };
    f.contents.emit('will-redirect', legacy, 'https://other.test/embedded', false, false);
    f.contents.emit('will-redirect', current, 'https://other.test/embedded');
    expect(legacy.preventDefault).not.toHaveBeenCalled();
    expect(current.preventDefault).not.toHaveBeenCalled();
    expect(f.owner.blockedReason).toBeUndefined();
    await f.owner.closeAndDrain();
  });
});
