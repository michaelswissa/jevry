import type { JevResponse } from './engine';

const RETRYABLE = new Set([429, 503, 529]);
const DEADLINE_MS = 25_000;
const REPLACEMENT_DELAY_MS = 10_000;
type Outcome = { kind: 'success'; value: JevResponse } | { kind: 'http'; status: number } |
  { kind: 'error'; error: unknown; phase: 'headers' | 'body' | 'deadline' };

function cancelBody(response?: Response) {
  // Abort cancels an active JSON reader. An unconsumed late response still needs
  // its body cancelled explicitly; never wait for a losing stream to drain.
  if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {});
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const aborted = () => { clearTimeout(timer); signal?.removeEventListener('abort', aborted); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', aborted); resolve(); }, ms);
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) aborted();
  });
}

function attempt(endpoint: string, init: RequestInit, signal: AbortSignal | undefined, allowReplacement: boolean,
  overloaded: () => void): Promise<Outcome> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const controllers: AbortController[] = [], responses: Array<Response | undefined> = [];
    const failures: Array<Outcome | undefined> = [];
    const knownHttpFailure = () => failures.find(item => item?.kind === 'http' && !RETRYABLE.has(item.status)) ||
      failures.find(item => item?.kind === 'http');
    let settled = false, pending = 0, primaryHeaders = false;
    let replacementTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = (reason: unknown, winner = -1) => {
      clearTimeout(deadline); clearTimeout(replacementTimer);
      signal?.removeEventListener('abort', callerAborted);
      controllers.forEach((controller, index) => {
        if (index !== winner) { controller.abort(reason); cancelBody(responses[index]); }
      });
    };
    const finish = (outcome: Outcome, winner = -1) => {
      if (settled) return;
      if (signal?.aborted) { callerAborted(); return; }
      settled = true;
      stop(new DOMException('Superseded Jev inference request.', 'AbortError'), winner);
      resolve(outcome);
    };
    const callerAborted = () => {
      if (settled) return;
      settled = true; stop(signal?.reason); reject(signal?.reason);
    };
    const deadline = setTimeout(() => {
      if (settled) return;
      settled = true;
      const error = new DOMException('Jev inference exceeded its 25-second deadline.', 'TimeoutError');
      // A stalled peer must not erase a known HTTP overload's normal backoff.
      stop(error); resolve(knownHttpFailure() || { kind: 'error', error, phase: 'deadline' });
    }, DEADLINE_MS);
    signal?.addEventListener('abort', callerAborted, { once: true });
    const failed = (index: number, outcome: Outcome) => {
      if (settled) return;
      failures[index] = outcome;
      if (--pending) return;
      // A definite HTTP result is more informative than a failed connection.
      // Preserve permanent HTTP errors before considering overload backoff.
      finish(knownHttpFailure() || failures.find(Boolean)!);
    };
    const start = () => {
      const index = controllers.length, controller = new AbortController();
      controllers.push(controller); pending++;
      void (async () => {
        let phase: 'headers' | 'body' = 'headers';
        try {
          const response = await fetch(endpoint, { ...init, signal: controller.signal });
          responses[index] = response;
          if (index === 0) { primaryHeaders = true; clearTimeout(replacementTimer); }
          if (settled) { cancelBody(response); return; }
          if (RETRYABLE.has(response.status)) { overloaded(); clearTimeout(replacementTimer); }
          if (!response.ok) { cancelBody(response); failed(index, { kind: 'http', status: response.status }); return; }
          phase = 'body';
          const value = await response.json() as JevResponse;
          if (!value || !value.answers || typeof value.answers !== 'object' || Array.isArray(value.answers)) {
            throw new Error('Jev returned an invalid answer. No action executed.');
          }
          finish({ kind: 'success', value }, index);
        } catch (error) { failed(index, { kind: 'error', error, phase }); }
      })();
    };
    if (signal?.aborted) { callerAborted(); return; }
    start();
    if (allowReplacement && !settled) replacementTimer = setTimeout(() => {
      if (!settled && !primaryHeaders) start();
    }, REPLACEMENT_DELAY_MS);
  });
}

/** Read-only inference transport; never encloses or replays browser input.
 * Existing overload backoff is documented at https://docs.typesafe.ai/api.
 * The delayed replacement is a local bounded experiment, not an API feature or
 * a proven speed improvement. A slow successful primary remains eligible.
 */
export async function fetchJevInference(endpoint: string, init: RequestInit, signal?: AbortSignal): Promise<JevResponse> {
  let sawOverload = false;
  for (let index = 0; index < 3; index++) {
    signal?.throwIfAborted();
    const outcome = await attempt(endpoint, init, signal, index === 0 && !sawOverload, () => { sawOverload = true; });
    signal?.throwIfAborted();
    if (outcome.kind === 'success') return outcome.value;
    if (outcome.kind === 'http') {
      if (RETRYABLE.has(outcome.status) && index < 2) { await pause(300 * 2 ** index, signal); continue; }
      throw new Error(`Jev returned HTTP ${outcome.status}. Check your key, endpoint, and model. No action executed.`);
    }
    if (outcome.phase === 'body') throw outcome.error;
    throw new Error(outcome.phase === 'deadline' ? 'Jev timed out. No action executed.' : 'Could not connect to Jev. No action executed.', { cause: outcome.error });
  }
  throw new Error('Jev is temporarily unavailable. No action executed.');
}
