import type { HandlerDetails, WebContents } from 'electron';
import type { BrowserAdapter, NavigationFeedback } from './engine';
import { navigateReady } from './navigation';
import { READ_STATE } from './snapshot';

type Popup = Pick<HandlerDetails, 'url' | 'postBody' | 'referrer'>;
type GetNavigation = { url: string; sourceUrl: string; referrer: HandlerDetails['referrer']; rejected?: boolean; superseded?: boolean };
class OriginRejected extends Error {
  constructor(readonly origin: string) { super('The page requested navigation outside the task’s allowed sites.'); }
}

/** A turn owns navigation in one WebContents, never the user's selected tab. */
export class OwnedPageNavigation {
  private queued?: GetNavigation;
  private pending?: GetNavigation;
  private rejectedPopup?: GetNavigation;
  private loading?: Promise<boolean>;
  private closed = false;
  private controller = new AbortController();
  private signal: AbortSignal;
  private issue?: string;
  private readonly origins?: Set<string>;
  private feedback: NavigationFeedback[] = [];
  private rejectedLinks = new Set<string>();

  constructor(private readonly contents: WebContents, options: {
    signal: AbortSignal;
    allowedOrigins?: string[];
    followed?: (url: string) => void;
    rejected?: (feedback: NavigationFeedback) => void;
  }) {
    this.signal = AbortSignal.any([options.signal, this.controller.signal]);
    this.origins = options.allowedOrigins ? new Set(options.allowedOrigins) : undefined;
    this.followed = options.followed;
    this.rejected = options.rejected;
    contents.on('will-navigate', this.navigationGuard);
    contents.on('will-redirect', this.redirectGuard);
  }

  private readonly followed?: (url: string) => void;
  private readonly rejected?: (feedback: NavigationFeedback) => void;
  get blockedReason() { return this.issue; }

  navigationFeedback(): readonly NavigationFeedback[] { return this.feedback.map(item => ({ ...item })); }
  isRejectedNavigation(sourceUrl: string, href: string): boolean {
    try { return this.rejectedLinks.has(JSON.stringify([sourceUrl, new URL(href, sourceUrl).href])); }
    catch { return false; }
  }

  private rejectGet(attempt: GetNavigation, rejection: OriginRejected, phase: NavigationFeedback['phase']) {
    attempt.rejected = true;
    const key = JSON.stringify([attempt.sourceUrl, attempt.url]);
    if (!this.rejectedLinks.has(key) && this.rejectedLinks.size >= 64) {
      this.issue = 'Too many destinations outside the allowed sites were requested during this turn.';
      return;
    }
    this.rejectedLinks.add(key);
    // Keep full source URLs only in the private equality set. Off-site query
    // strings, paths and tokens never become model feedback or page evidence.
    const item: NavigationFeedback = { kind: 'origin_rejected', phase, reason: 'outside_allowed_sites', ...(rejection.origin.length <= 512 ? { origin: rejection.origin } : {}) };
    if (!this.feedback.some(prior => prior.origin === item.origin && prior.phase === item.phase)) {
      this.feedback = [...this.feedback, item].slice(-6);
      this.rejected?.({ ...item });
    }
  }

  private allowed(target: string): string {
    const url = new URL(target);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('The page requested an unsupported navigation address.');
    if (this.origins && !this.origins.has(url.origin)) throw new OriginRejected(url.origin);
    return url.href;
  }

  /** Validate initial/programmatic loads too; Electron does not emit will-navigate for loadURL. */
  assertAllowed(target: string) { this.signal.throwIfAborted(); return this.allowed(target); }

  private navigationGuard = (event: Electron.Event & { isMainFrame?: boolean }, target: string, isInPlace?: boolean, isMainFrame?: boolean) => {
    this.guard(false, event, target, isInPlace, isMainFrame);
  };
  private redirectGuard = (event: Electron.Event & { isMainFrame?: boolean }, target: string, isInPlace?: boolean, isMainFrame?: boolean) => {
    this.guard(true, event, target, isInPlace, isMainFrame);
  };
  private guard = (redirect: boolean, event: Electron.Event & { isMainFrame?: boolean }, target: string, _isInPlace?: boolean, isMainFrame?: boolean) => {
    if (this.closed || this.signal.aborted) return;
    // Task scope bounds the owned destination, not embedded resources such as
    // a site's verification provider. Electron also emits child-frame redirects.
    if (event.isMainFrame === false || isMainFrame === false) return;
    // loadURL itself does not emit will-navigate. A new page-initiated request
    // during that load could be a POST and is not part of the proven GET chain.
    if (!redirect && this.pending) this.pending.superseded = true;
    try { this.allowed(target); }
    catch (error) {
      event.preventDefault();
      this.queued = undefined;
      // Only our queued popup load is proven GET. An unrelated navigation may
      // be a submitted form; keep that ambiguity fatal instead of retrying it.
      if (error instanceof OriginRejected && redirect && this.pending && !this.pending.superseded) this.rejectGet(this.pending, error, 'redirect');
      else this.issue = error instanceof Error ? error.message : 'The page requested an unsupported navigation.';
    }
  };

  /** Queue only: never navigate while native mouse/key release is still in flight. */
  popup(details: Popup): { action: 'deny' } {
    if (this.closed || this.signal.aborted) return { action: 'deny' };
    try {
      if (details.postBody != null) throw new Error('This action opened a form submission in a separate page. Its posted data was not replayed or replaced with a GET request.');
      const url = new URL(details.url).href;
      if (this.loading || this.queued && this.queued.url !== url || this.rejectedPopup && this.rejectedPopup.url !== url) throw new Error('The page opened multiple destinations before the previous navigation finished.');
      const next: GetNavigation = { url, sourceUrl: this.contents.getURL(), referrer: details.referrer };
      try { this.allowed(url); }
      catch (error) {
        if (!(error instanceof OriginRejected)) throw error;
        this.rejectGet(next, error, 'popup');
        this.rejectedPopup = next;
        return { action: 'deny' };
      }
      if (!this.issue) this.queued = next;
    } catch (error) {
      this.queued = undefined;
      this.issue = error instanceof Error ? error.message : 'The new page could not be followed.';
    }
    return { action: 'deny' };
  }

  /** Called after dispatch, at the ordinary read/settle boundary. Never replays an input. */
  async flush(): Promise<boolean> {
    this.signal.throwIfAborted();
    if (this.closed || this.issue) return false;
    if (this.rejectedPopup) {
      if (this.contents.getURL() !== this.rejectedPopup.sourceUrl) this.issue = 'The rejected navigation replaced the source page. Inspect the current page before continuing.';
      this.rejectedPopup = undefined;
      if (this.issue) return false;
    }
    if (this.loading) return this.loading;
    const next = this.queued;
    if (!next) return false;
    this.queued = undefined;
    this.pending = next;
    const work = (async () => {
      try {
        this.signal.throwIfAborted();
        await navigateReady(this.contents, this.allowed(next.url), this.signal, 25_000, { httpReferrer: next.referrer });
        this.signal.throwIfAborted();
        if (next.rejected) {
          if (this.contents.getURL() !== next.sourceUrl) this.issue ||= 'The rejected navigation replaced the source page. Inspect the current page before continuing.';
          return false;
        }
        if (this.issue) return false;
        this.followed?.(this.contents.getURL());
        return true;
      } catch (error) {
        this.signal.throwIfAborted();
        if (!next.rejected) this.issue ||= error instanceof Error ? error.message : 'The requested page could not be loaded.';
        else if (this.contents.getURL() !== next.sourceUrl) this.issue ||= 'The rejected navigation replaced the source page. Inspect the current page before continuing.';
        return false;
      }
    })();
    this.loading = work;
    try { return await work; }
    finally { if (this.loading === work) this.loading = undefined; if (this.pending === next) this.pending = undefined; }
  }

  wrap(browser: BrowserAdapter): BrowserAdapter {
    return {
      ...browser,
      navigationFeedback: () => this.navigationFeedback(),
      isRejectedNavigation: (sourceUrl, href) => this.isRejectedNavigation(sourceUrl, href),
      evaluate: async <T>(expression: string): Promise<T> => {
        // Do not switch pages during a click's target/focus checks or between
        // keyDown and keyUp. Both boundaries below occur after dispatch ends.
        if (expression === READ_STATE || expression.startsWith('/* jev:settle */')) await this.flush();
        return browser.evaluate<T>(expression);
      },
      navigate: async url => { await browser.navigate(this.assertAllowed(url)); },
    };
  }

  async closeAndDrain() {
    this.closed = true;
    this.queued = undefined;
    this.rejectedPopup = undefined;
    this.controller.abort(new DOMException('Turn ended', 'AbortError'));
    try { await this.loading; } catch { /* The caller's cancellation owns the outcome. */ }
    this.contents.removeListener('will-navigate', this.navigationGuard);
    this.contents.removeListener('will-redirect', this.redirectGuard);
    this.feedback = [];
    this.rejectedLinks.clear();
  }
}
