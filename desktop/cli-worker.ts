import { randomUUID } from 'node:crypto'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

const MAX_OUTPUT = 1_048_576
type Delta = (text: string) => void
export type ClaudeUserContent = { type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: 'image/png' | 'image/jpeg'; data: string } }
type Pending = {
  id: string; signal: AbortSignal; abort: () => void; output: string; acknowledged: boolean
  resolve: (text: string) => void; reject: (error: Error) => void; delta?: Delta
  timeout: ReturnType<typeof setTimeout>
}

export class UnsupportedWorkerProtocol extends Error {
  constructor(public readonly safeToRetry: boolean) { super('This Claude version does not support the scoped text worker protocol.') }
}
/** The isolated text worker is closed and drained before this error rejects. */
export class ClaudeStreamMismatch extends Error {
  constructor() { super('Claude final output did not match its streamed response.') }
}
export interface ClaudeWorkerOptions {
  sessionId: string
  terminate: (force: boolean) => void
  cleanup: () => Promise<void>
  idleMs?: number
  timeoutMs?: number
  /** Image requests are never retained for a subsequent turn. */
  singleUse?: boolean
}

/** A serial, tool-disabled Claude session. A result must identify the exact input UUID. */
export class ClaudeTextWorker {
  private pending?: Pending
  private buffer = ''
  private stderr = ''
  private outputBytes = 0
  private replayBytes = 0
  private idle?: ReturnType<typeof setTimeout>
  private escalation?: ReturnType<typeof setTimeout>
  private closing = false
  private finished = false
  private failure?: Error
  private initSeen = false
  private correlated = false
  private turns = 0
  private inputChars = 0
  private model?: string
  private resolveClosed!: () => void
  readonly closed = new Promise<void>(resolve => { this.resolveClosed = resolve })

  constructor(private child: ChildProcessWithoutNullStreams, private options: ClaudeWorkerOptions) {
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (this.closing) return
      this.outputBytes += Buffer.byteLength(chunk)
      if (this.outputBytes > MAX_OUTPUT + this.replayBytes) { void this.close(new Error('Claude worker output exceeded the limit.')); return }
      this.buffer += chunk
      const lines = this.buffer.split('\n'); this.buffer = lines.pop() || ''
      try { for (const line of lines) if (line.trim()) {
        let data: Record<string, any>
        try { data = JSON.parse(line) } catch { throw new Error('Claude returned malformed worker data.') }
        this.event(data)
      } }
      catch (error) { void this.close(error instanceof Error ? error : new Error('Claude returned malformed worker data.')) }
    })
    child.stderr.on('data', (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-16_000)
    })
    child.stdin.on('error', () => { void this.close(new Error('The Claude worker input stream closed.')) })
    child.once('error', () => { this.failure = new Error('Could not start the Claude text worker.'); void this.finish() })
    child.once('close', () => {
      if (!this.failure && this.pending) {
        const unsupported = !this.initSeen && !this.pending.acknowledged && !this.pending.output && /(?:unknown|unrecognized|unexpected|invalid).*(?:input-format|replay-user-messages|session-id)/i.test(this.stderr)
        this.failure = unsupported ? new UnsupportedWorkerProtocol(true) : new Error('The Claude worker exited before completing its response.')
      }
      void this.finish()
    })
  }

  get reusable() { return !this.options.singleUse && !this.closing && !this.finished && this.correlated && this.turns < 8 && this.inputChars < 200_000 }
  get alive() { return !this.closing && !this.finished }
  get protocolSupported() { return this.correlated }
  get resolvedModel() { return this.model }

  async request(prompt: string | ClaudeUserContent[], signal: AbortSignal, delta?: Delta): Promise<string> {
    if (signal.aborted) throw signal.reason
    if (!this.alive || this.pending) throw new Error('The Claude worker is not available for a new request.')
    clearTimeout(this.idle)
    this.outputBytes = 0
    if (typeof prompt !== 'string' && !this.options.singleUse) throw new Error('Image input requires an ephemeral Claude worker.')
    const inputSize = typeof prompt === 'string' ? prompt.length : Buffer.byteLength(JSON.stringify(prompt))
    this.inputChars += inputSize
    // --replay-user-messages echoes the image once. Keep the response budget separate.
    this.replayBytes = typeof prompt === 'string' ? 0 : inputSize + 4096
    return new Promise<string>((resolve, reject) => {
      const abort = () => { void this.close(Object.assign(new Error('Request cancelled.'), { name: 'AbortError' })) }
      const timeout = setTimeout(() => { void this.close(new Error('Claude timed out. Try again or choose another model.')) }, this.options.timeoutMs ?? 120_000)
      this.pending = { id: randomUUID(), signal, abort, timeout, output: '', acknowledged: false, resolve, reject, delta }
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) { abort(); return }
      this.child.stdin.write(JSON.stringify({ type: 'user', uuid: this.pending.id, session_id: this.options.sessionId,
        parent_tool_use_id: null, message: { role: 'user', content: prompt } }) + '\n')
    })
  }

  private event(data: Record<string, any>) {
    if (this.closing || this.finished) return
    if (!data || typeof data !== 'object' || typeof data.type !== 'string') throw new Error('Claude returned an invalid worker event.')
    if (data.type === 'error') throw new Error('Claude reported a worker error. Check your connection and selected model.')
    if (data.type === 'stream_event' && data.event?.delta?.stop_reason === 'max_tokens') throw new Error('The Claude response was cut off. Retry with a shorter task.')
    if (data.session_id && data.session_id !== this.options.sessionId) throw new Error('Claude returned data from an unexpected session.')
    if (data.parent_tool_use_id != null || data.type === 'control_request' || data.type === 'tool_use' || data.type === 'tool_result' ||
      data.type === 'assistant' && data.message?.content?.some((part: any) => /tool_use|tool_result/.test(part.type)) ||
      data.type === 'stream_event' && /tool_use|tool_result/.test(data.event?.content_block?.type || '')) {
      throw new Error('The text provider attempted a tool action. The request was stopped.')
    }
    if (data.type === 'system' && data.subtype === 'init') {
      if (data.session_id !== this.options.sessionId || !Array.isArray(data.tools) || data.tools.length ||
          !Array.isArray(data.mcp_servers) || data.mcp_servers.length || data.skills?.length || data.slash_commands?.length) {
        throw new Error('Claude could not establish an isolated text session.')
      }
      this.initSeen = true
      if (typeof data.model === 'string' && /^[a-zA-Z0-9._:/-]{1,200}$/.test(data.model)) this.model = data.model
      return
    }
    const p = this.pending
    if (!p) {
      if (['result', 'assistant', 'stream_event', 'user'].includes(data.type)) throw new Error('Claude sent an unexpected event after the completed turn.')
      return
    }
    if (data.user_message_uuid && data.user_message_uuid !== p.id) throw new Error('Claude returned a response for a different request.')
    if (data.type === 'user') {
      if (data.uuid !== p.id || data.session_id !== this.options.sessionId || data.parent_tool_use_id != null) throw new Error('Claude acknowledged a different request.')
      if (p.acknowledged) throw new Error('Claude acknowledged the same request twice.')
      p.acknowledged = true
    }
    if (data.type === 'stream_event' && data.event?.type === 'content_block_delta' && data.event.delta?.type === 'text_delta') {
      if (!p.acknowledged || !this.initSeen || typeof data.event.delta.text !== 'string') throw new Error('Claude streamed text before acknowledging this request.')
      p.output += data.event.delta.text
      if (p.output.length > MAX_OUTPUT) throw new Error('Claude worker output exceeded the limit.')
      p.delta?.(data.event.delta.text)
    }
    if (data.type !== 'result') return
    if (data.session_id !== this.options.sessionId || data.is_error !== false || data.subtype !== 'success' || data.permission_denials?.length) {
      throw new Error('Claude could not complete this request. Check your connection and selected model.')
    }
    const ids = data.user_message_uuids
    const hasCorrelation = data.user_message_uuid === p.id && Array.isArray(ids) && ids.length === 1 && ids[0] === p.id && p.acknowledged && this.initSeen
    // Older CLIs can safely finish the sole first request, but cannot be reused.
    if (!hasCorrelation && (this.turns > 0 || data.user_message_uuid || ids)) throw new Error('Claude returned an ambiguous response. The worker was stopped.')
    if (typeof data.result !== 'string' || !data.result.trim() || data.result.length > MAX_OUTPUT) throw new Error('Claude returned an empty or oversized response.')
    let parsed: unknown
    try { parsed = JSON.parse(data.result.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) }
    catch { throw new Error('Claude returned invalid JSON. Retry this message.') }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Claude returned an invalid response object.')
    if (p.output && p.output.trim() !== data.result.trim()) throw new ClaudeStreamMismatch()
    if (!p.output) p.delta?.(data.result)
    if (p.signal.aborted) { void this.close(Object.assign(new Error('Request cancelled.'), { name: 'AbortError' })); return }
    this.correlated = hasCorrelation
    this.turns++
    this.pending = undefined
    clearTimeout(p.timeout); p.signal.removeEventListener('abort', p.abort)
    if (!this.reusable) {
      void this.close().then(() => p.resolve(data.result.trim()))
    } else {
      this.idle = setTimeout(() => { void this.close() }, this.options.idleMs ?? 120_000)
      this.idle.unref()
      p.resolve(data.result.trim())
    }
  }

  async close(error?: Error, force = false): Promise<void> {
    if (error && !this.failure) this.failure = error
    if (!this.closing && !this.finished) {
      this.closing = true
      clearTimeout(this.idle)
      this.options.terminate(force)
      if (!force) {
        this.escalation = setTimeout(() => { this.options.terminate(true) }, 1000)
        this.escalation.unref()
      }
    } else if (force && !this.finished) {
      this.options.terminate(true)
    }
    await this.closed
  }

  private async finish() {
    if (this.finished) return
    this.finished = true; this.closing = true
    this.buffer = ''; this.stderr = ''; this.replayBytes = 0
    clearTimeout(this.idle); clearTimeout(this.escalation)
    const p = this.pending; this.pending = undefined
    if (p) { clearTimeout(p.timeout); p.signal.removeEventListener('abort', p.abort) }
    try { await this.options.cleanup() } catch { /* A failed temporary-directory removal cannot revive the worker. */ }
    this.resolveClosed()
    if (p) p.reject(this.failure || new Error('The Claude worker stopped before returning a result.'))
  }
}
