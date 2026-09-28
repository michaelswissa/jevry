import type { JevResponse } from './engine';

const RETRYABLE = new Set([429, 503, 529]);
const DEADLINE_MS = 25_000;
const REPLACEMENT_DELAY_MS = 10_000;
type Outcome = { kind: 'success'; value: JevResponse } | { kind: 'http'; status: number; detail?: string } |
  { kind: 'error'; error: unknown; phase: 'headers' | 'body' | 'deadline' };

/** Only read a small structured error, never dump HTML or the request state. */
async function errorDetail(response: Response, init: RequestInit, controller: AbortController): Promise<string | undefined> {
  if (!response.body || !response.headers.get('content-type')?.includes('application/json')) {
    cancelBody(response); return;
  }
  const reader = response.body.getReader();
  const timer = setTimeout(() => controller.abort(new DOMException('Error details timed out.', 'TimeoutError')), 1000);
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) return;
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const data = JSON.parse(new TextDecoder().decode(bytes));
    const detail = data?.error?.message ?? data?.detail?.message ?? data?.message ?? data?.detail ?? data?.error;
    // Validation arrays can include the original input; never serialize them.
    if (typeof detail !== 'string') return;
    let safe = detail;
    const authorization = new Headers(init.headers).get('authorization') || '';
    for (const secret of [authorization, authorization.replace(/^Bearer\s+/i, '')]) {
      if (secret) safe = safe.split(secret).join('[redacted]');
    }
    return safe.replace(/\b(?:Bearer|Basic)\s+[^\s"'<>]+/gi, '[redacted]')
      .replace(/\bsk-[A-Za-z0-9_-]+/g, '[redacted]')
      .replace(/((?:access_token|refresh_token|api_key|client_secret)["']?\s*[:=]\s*["']?)[^\s"'&,}]+/gi, '$1[redacted]')
      .replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 400) || undefined;
  } catch { return; }
  finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function httpError(status: number, detail?: string): Error {
  const guidance = status === 400 || status === 422
    ? 'Jev rejected the request. Check the Jev model and endpoint in Connections; if they are correct, report this error with the task that triggered it.'
    : status === 401 || status === 403
      ? 'Check your TypeSafe API key and its access in Connections.'
      : status === 404
        ? 'Check the Jev endpoint and model in Connections.'
        : status === 429
          ? 'The Jev rate limit was reached. Wait briefly and try again.'
          : status >= 500 ? 'Jev is temporarily unavailable. Try again shortly.'
            : 'Check your Jev connection in Connections.';
  return new Error(`Jev returned HTTP ${status}. ${guidance}${detail ? ` Server detail: ${detail}` : ''} No action executed.`);
}

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
          if (!response.ok) {
            // Keep the known status even if its optional body stalls or fails.
            const failure: Extract<Outcome, { kind: 'http' }> = { kind: 'http', status: response.status };
            failures[index] = failure;
            if (RETRYABLE.has(response.status)) cancelBody(response);
            else failure.detail = await errorDetail(response, init, controller);
            failed(index, failure); return;
          }
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
      throw httpError(outcome.status, outcome.detail);
    }
    if (outcome.phase === 'body') throw outcome.error;
    throw new Error(outcome.phase === 'deadline' ? 'Jev timed out. No action executed.' : 'Could not connect to Jev. No action executed.', { cause: outcome.error });
  }
  throw new Error('Jev is temporarily unavailable. No action executed.');
}
