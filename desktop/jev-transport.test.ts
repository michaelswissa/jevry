import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchJevInference } from './jev-transport';

const endpoint = 'https://fixture.invalid/systemone';
const init = { method: 'POST', body: '{"fixture":true}', headers: { 'Content-Type': 'application/json' } };
const success = (model: string) => new Response(JSON.stringify({ model, answers: {} }), { headers: { 'Content-Type': 'application/json' } });
type Pending = { signal: AbortSignal; respond: (response: Response) => void; fail: (error: unknown) => void };
function network(ignoreAbort = false) {
  const calls: Pending[] = [];
  const fetch = vi.fn((_url: unknown, options: RequestInit) => new Promise<Response>((respond, fail) => {
    const signal = options.signal!;
    calls.push({ signal, respond, fail });
    if (!ignoreAbort) signal.addEventListener('abort', () => fail(signal.reason), { once: true });
  }));
  vi.stubGlobal('fetch', fetch); return { calls, fetch };
}
function streaming(signal: AbortSignal) {
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const cancel = vi.fn();
  const response = new Response(new ReadableStream<Uint8Array>({
    start(value) { controller = value; signal.addEventListener('abort', () => { try { value.error(signal.reason); } catch {} }, { once: true }); }, cancel,
  }));
  return { response, cancel, complete: (value: string) => { controller.enqueue(new TextEncoder().encode(value)); controller.close(); } };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('bounded delayed inference replacement', () => {
  it('keeps a primary success at 13 seconds eligible and cancels the replacement', async () => {
    const { calls, fetch } = network(); const work = fetchJevInference(endpoint, init);
    await vi.advanceTimersByTimeAsync(9999); expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0]).toBe(endpoint); expect(fetch.mock.calls[1][1].body).toBe(init.body);
    await vi.advanceTimersByTimeAsync(3000); calls[0].respond(success('primary'));
    expect(await work).toMatchObject({ model: 'primary' });
    expect(calls[1].signal.aborted).toBe(true); expect(calls[0].signal.aborted).toBe(false); expect(vi.getTimerCount()).toBe(0);
  });

  it('allows the replacement to rescue a stalled primary without changing its input', async () => {
    const { calls, fetch } = network(); const work = fetchJevInference(endpoint, init);
    await vi.advanceTimersByTimeAsync(10000); calls[1].respond(success('replacement'));
    expect(await work).toMatchObject({ model: 'replacement' });
    expect(calls[0].signal.aborted).toBe(true); expect(fetch).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels a late loser body even when its fetch ignores abort', async () => {
    const { calls } = network(true); const work = fetchJevInference(endpoint, init);
    await vi.advanceTimersByTimeAsync(10000); calls[1].respond(success('replacement')); await work;
    const cancel = vi.fn(); calls[0].respond(new Response(new ReadableStream({ cancel })));
    await vi.advanceTimersByTimeAsync(0); expect(cancel).toHaveBeenCalledOnce();
  });

  it('aborts a losing JSON reader when the other request finishes first', async () => {
    const { calls } = network(); const work = fetchJevInference(endpoint, init);
    await vi.advanceTimersByTimeAsync(10000); calls[0].respond(streaming(calls[0].signal).response);
    await vi.advanceTimersByTimeAsync(0); calls[1].respond(success('replacement'));
    expect(await work).toMatchObject({ model: 'replacement' });
    expect(calls[0].signal.aborted).toBe(true); await vi.advanceTimersByTimeAsync(0); expect(vi.getTimerCount()).toBe(0);
  });

  it('does not turn one failed arm into a failure while its peer can still succeed', async () => {
    const { calls } = network(); const work = fetchJevInference(endpoint, init);
    await vi.advanceTimersByTimeAsync(10000); calls[1].fail(new TypeError('Replacement connection failed'));
    await vi.advanceTimersByTimeAsync(3000); calls[0].respond(success('primary'));
    expect(await work).toMatchObject({ model: 'primary' });
  });

  it('fails after both connections fail, without a third speculative request', async () => {
    const { calls, fetch } = network(); const work = fetchJevInference(endpoint, init);
    const rejected = expect(work).rejects.toThrow('Could not connect to Jev');
    await vi.advanceTimersByTimeAsync(10000); calls[0].fail(new TypeError('Primary failed')); calls[1].fail(new TypeError('Replacement failed'));
    await rejected; expect(fetch).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });

  it('enforces the same 25-second deadline across both requests', async () => {
    const { calls, fetch } = network(); const work = fetchJevInference(endpoint, init);
    const rejected = expect(work).rejects.toThrow('Jev timed out. No action executed.');
    await vi.advanceTimersByTimeAsync(25000); await rejected;
    expect(fetch).toHaveBeenCalledTimes(2); expect(calls.every(call => call.signal.aborted)).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });

  it.each([5000, 11000])('caller cancellation at %i ms cancels every request without retry', async elapsed => {
    const { calls, fetch } = network(); const controller = new AbortController();
    const work = fetchJevInference(endpoint, init, controller.signal), reason = new DOMException('User stopped', 'AbortError');
    const rejected = expect(work).rejects.toBe(reason);
    await vi.advanceTimersByTimeAsync(elapsed); controller.abort(reason); await rejected;
    await vi.advanceTimersByTimeAsync(30000); expect(fetch).toHaveBeenCalledTimes(elapsed < 10000 ? 1 : 2);
    expect(calls.every(call => call.signal.aborted)).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });

  it.each([429, 503, 529])('keeps existing backoff for HTTP %i and never hedges the later attempt', async status => {
    const { calls, fetch } = network(); const work = fetchJevInference(endpoint, init);
    calls[0].respond(new Response('overloaded', { status }));
    await vi.advanceTimersByTimeAsync(299); expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(12000); expect(fetch).toHaveBeenCalledTimes(2);
    calls[1].respond(success('after-backoff')); expect(await work).toMatchObject({ model: 'after-backoff' });
  });

  it('preserves a pending primary when the already-started replacement reports overload', async () => {
    const { calls, fetch } = network(); const work = fetchJevInference(endpoint, init);
    await vi.advanceTimersByTimeAsync(10000); calls[1].respond(new Response('overloaded', { status: 529 }));
    await vi.advanceTimersByTimeAsync(3000); calls[0].respond(success('primary'));
    expect(await work).toMatchObject({ model: 'primary' }); expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retains known overload backoff if the other arm stalls until the shared deadline', async () => {
    const { calls, fetch } = network(); const work = fetchJevInference(endpoint, init);
    await vi.advanceTimersByTimeAsync(10000); calls[1].respond(new Response('overloaded', { status: 529 }));
    await vi.advanceTimersByTimeAsync(15000); expect(calls[0].signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(300); expect(fetch).toHaveBeenCalledTimes(3);
    calls[2].respond(success('after-backoff')); expect(await work).toMatchObject({ model: 'after-backoff' });
  });

  it('stops after the existing three overload attempts with 300/600 ms backoffs', async () => {
    const { calls, fetch } = network(); const work = fetchJevInference(endpoint, init);
    const rejected = expect(work).rejects.toThrow('Jev returned HTTP 529');
    calls[0].respond(new Response('overloaded', { status: 529 })); await vi.advanceTimersByTimeAsync(300);
    calls[1].respond(new Response('overloaded', { status: 529 })); await vi.advanceTimersByTimeAsync(599); expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); calls[2].respond(new Response('overloaded', { status: 529 }));
    await rejected; expect(fetch).toHaveBeenCalledTimes(3); expect(vi.getTimerCount()).toBe(0);
  });

  it('starts at most one replacement across a hedged overload followed by serial retries', async () => {
    const { calls, fetch } = network(); const work = fetchJevInference(endpoint, init);
    const rejected = expect(work).rejects.toThrow('Jev returned HTTP 529');
    await vi.advanceTimersByTimeAsync(10000);
    calls[0].respond(new Response('overloaded', { status: 529 })); calls[1].respond(new Response('overloaded', { status: 529 }));
    await vi.advanceTimersByTimeAsync(300); expect(fetch).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(12000); expect(fetch).toHaveBeenCalledTimes(3);
    calls[2].respond(new Response('overloaded', { status: 529 })); await vi.advanceTimersByTimeAsync(600);
    calls[3].respond(new Response('overloaded', { status: 529 })); await rejected;
    expect(fetch).toHaveBeenCalledTimes(4); expect(vi.getTimerCount()).toBe(0);
  });

  it('does not hedge a slow JSON body after primary headers have arrived', async () => {
    const { calls, fetch } = network(); const work = fetchJevInference(endpoint, init);
    await vi.advanceTimersByTimeAsync(1000); const body = streaming(calls[0].signal); calls[0].respond(body.response);
    await vi.advanceTimersByTimeAsync(12000); expect(fetch).toHaveBeenCalledTimes(1);
    body.complete('{"answers":{},"model":"slow-body"}'); expect(await work).toMatchObject({ model: 'slow-body' });
  });

  it('times out a stalled JSON body and cancels its active reader', async () => {
    const { calls, fetch } = network(); const work = fetchJevInference(endpoint, init);
    const rejected = expect(work).rejects.toThrow('Jev timed out');
    calls[0].respond(streaming(calls[0].signal).response); await vi.advanceTimersByTimeAsync(25000); await rejected;
    expect(fetch).toHaveBeenCalledTimes(1); expect(calls[0].signal.aborted).toBe(true);
  });

  it('requires parsed valid JSON before choosing a winner', async () => {
    const { calls } = network(); const work = fetchJevInference(endpoint, init);
    await vi.advanceTimersByTimeAsync(10000); calls[0].respond(new Response('not JSON'));
    await vi.advanceTimersByTimeAsync(100); calls[1].respond(success('valid-replacement'));
    expect(await work).toMatchObject({ model: 'valid-replacement' });
  });

  it('rejects invalid envelopes and permanent HTTP failures without retrying', async () => {
    for (const response of [new Response('{"answers":[]}'), new Response('bad request', { status: 400 })]) {
      const { calls, fetch } = network(); const work = fetchJevInference(endpoint, init);
      const rejected = expect(work).rejects.toThrow(response.ok ? 'invalid answer' : 'HTTP 400');
      calls[0].respond(response); await rejected; await vi.advanceTimersByTimeAsync(30000);
      expect(fetch).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
    }
  });

  it('makes no request for an already-cancelled caller', async () => {
    const { fetch } = network(); const controller = new AbortController(); controller.abort();
    await expect(fetchJevInference(endpoint, init, controller.signal)).rejects.toBe(controller.signal.reason);
    expect(fetch).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
});
