import { EventEmitter } from 'node:events'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClaudeTextWorker, UnsupportedWorkerProtocol, ClaudeStreamMismatch } from './cli-worker'

const workers: ClaudeTextWorker[] = []
afterEach(async () => { for (const worker of workers.splice(0)) await worker.close(); vi.useRealTimers() })

function fixture(autoClose = true, extra: { idleMs?: number; timeoutMs?: number; singleUse?: boolean } = {}) {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough() })
  const inputs: Record<string, any>[] = []
  child.stdin.on('data', chunk => inputs.push(JSON.parse(String(chunk))))
  const terminate = vi.fn(() => { if (autoClose) queueMicrotask(() => child.emit('close', 0)) })
  const cleanup = vi.fn(async () => undefined)
  const worker = new ClaudeTextWorker(child as unknown as ChildProcessWithoutNullStreams, { sessionId: 'session-a', terminate, cleanup, ...extra })
  workers.push(worker)
  const event = (value: unknown) => child.stdout.write(JSON.stringify(value) + '\n')
  const init = (overrides = {}) => event({ type: 'system', subtype: 'init', session_id: 'session-a', tools: [], mcp_servers: [], skills: [], slash_commands: [], ...overrides })
  const acknowledge = () => event({ type: 'user', session_id: 'session-a', uuid: inputs.at(-1)!.uuid, parent_tool_use_id: null })
  const result = (overrides = {}) => event({ type: 'result', subtype: 'success', is_error: false, session_id: 'session-a', user_message_uuid: inputs.at(-1)!.uuid, user_message_uuids: [inputs.at(-1)!.uuid], result: '{"ok":true}', permission_denials: [], ...overrides })
  return { worker, child, inputs, terminate, cleanup, event, init, acknowledge, result }
}

describe('scoped Claude worker protocol', () => {
  it('accepts a large echoed image only in a single-use worker and destroys its session', async () => {
    const f = fixture(true, { singleUse: true })
    const task = f.worker.request([{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'a'.repeat(2 * 1024 * 1024) } }, { type: 'text', text: 'inspect' }], new AbortController().signal)
    f.init(); f.event(f.inputs[0]); f.result()
    expect(await task).toBe('{"ok":true}')
    expect(f.worker.reusable).toBe(false)
    expect(f.cleanup).toHaveBeenCalledTimes(1)
    await expect(f.worker.request('next', new AbortController().signal)).rejects.toThrow('not available')
    const scoped = fixture()
    await expect(scoped.worker.request([{ type: 'text', text: 'image content' }], new AbortController().signal)).rejects.toThrow('ephemeral')
    expect(scoped.inputs).toHaveLength(0)
  })

  it('drains a cancelled image request before cleanup finishes and ignores late results', async () => {
    const f = fixture(false, { singleUse: true }), controller = new AbortController()
    const task = f.worker.request([{ type: 'text', text: 'inspect' }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/2Q==' } }], controller.signal)
    let settled = false
    const rejected = expect(task).rejects.toMatchObject({ name: 'AbortError' }).then(() => { settled = true })
    f.init(); f.acknowledge(); controller.abort(); f.result()
    await Promise.resolve(); expect(settled).toBe(false)
    f.child.emit('close', 0); await rejected
    expect(f.cleanup).toHaveBeenCalledTimes(1)
  })

  it('terminates a timed-out image worker, escalates, and drains before rejecting', async () => {
    vi.useFakeTimers()
    const f = fixture(false, { singleUse: true, timeoutMs: 30_000 })
    const task = f.worker.request([{ type: 'text', text: 'inspect' }], new AbortController().signal)
    let settled = false
    const rejected = expect(task).rejects.toThrow('timed out').then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(f.terminate).toHaveBeenCalledWith(false); expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.terminate).toHaveBeenCalledWith(true); expect(settled).toBe(false)
    f.child.emit('close', null); await rejected
    expect(f.cleanup).toHaveBeenCalledTimes(1)
  })

  it('correlates sequential turns by input UUID without ending the process between turns', async () => {
    const f = fixture()
    const delta = vi.fn()
    const first = f.worker.request('first private prompt', new AbortController().signal, delta)
    f.init(); f.acknowledge()
    f.event({ type: 'stream_event', session_id: 'session-a', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '{"ok":true}' } } })
    f.result()
    expect(await first).toBe('{"ok":true}')
    expect(delta).toHaveBeenCalledTimes(1)
    expect(f.worker.reusable).toBe(true)
    const second = f.worker.request('second explicit context', new AbortController().signal)
    f.init(); f.acknowledge(); f.result()
    expect(await second).toBe('{"ok":true}')
    expect(f.inputs[0].uuid).not.toBe(f.inputs[1].uuid)
    expect(f.inputs[1].message.content).toBe('second explicit context')
    expect(f.terminate).not.toHaveBeenCalled()
  })

  it('kills and drains before rejecting cancellation, ignoring late output', async () => {
    const f = fixture(false)
    const controller = new AbortController(), delta = vi.fn()
    let settled = false
    const task = f.worker.request('pending', controller.signal, delta)
    const rejection = expect(task).rejects.toMatchObject({ name: 'AbortError' }).then(() => { settled = true })
    f.init(); f.acknowledge(); controller.abort()
    f.result(); await Promise.resolve()
    expect(settled).toBe(false)
    expect(f.terminate).toHaveBeenCalledWith(false)
    f.child.emit('close', null)
    await rejection
    expect(f.cleanup).toHaveBeenCalledTimes(1)
    expect(delta).not.toHaveBeenCalled()
  })

  it('rejects mismatched request UUIDs instead of replaying a request', async () => {
    const f = fixture()
    const task = f.worker.request('private prompt', new AbortController().signal)
    const rejection = expect(task).rejects.toThrow('different request')
    f.init(); f.acknowledge(); f.result({ user_message_uuid: 'previous-turn' })
    await rejection
    expect(f.inputs).toHaveLength(1)
    expect(f.worker.reusable).toBe(false)
  })

  it('discards a mismatched final response and drains the worker before exposing a retryable text error', async () => {
    const f=fixture(false),task=f.worker.request('Read-only plan',new AbortController().signal)
    let settled=false
    const rejected=expect(task).rejects.toBeInstanceOf(ClaudeStreamMismatch).then(()=>{settled=true})
    f.init();f.acknowledge();f.event({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:'{"ok":false}'}}});f.result()
    await Promise.resolve();expect(settled).toBe(false);expect(f.worker.reusable).toBe(false);expect(f.terminate).toHaveBeenCalledOnce()
    f.child.emit('close',null);await rejected;expect(f.inputs).toHaveLength(1);expect(f.cleanup).toHaveBeenCalledOnce()
  })

  it('finishes an uncorrelated first result once, then retires instead of sharing its history', async () => {
    const f = fixture()
    const task = f.worker.request('single request', new AbortController().signal)
    f.init(); f.acknowledge(); f.result({ user_message_uuid: undefined, user_message_uuids: undefined })
    expect(await task).toBe('{"ok":true}')
    expect(f.worker.protocolSupported).toBe(false)
    expect(f.terminate).toHaveBeenCalledTimes(1)
    await expect(f.worker.request('next', new AbortController().signal)).rejects.toThrow('not available')
  })

  it('identifies unsupported startup flags only before any acknowledged or streamed request', async () => {
    const f = fixture()
    const task = f.worker.request('unprocessed', new AbortController().signal)
    const rejection = expect(task).rejects.toMatchObject({ safeToRetry: true })
    f.child.stderr.write('error: unknown option --input-format')
    f.child.emit('close', 1)
    await rejection
    expect(UnsupportedWorkerProtocol.prototype).toBeInstanceOf(Error)
  })

  it.each([
    { type: 'control_request', request: { subtype: 'can_use_tool' } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } },
    { type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use' } } },
    { type: 'assistant', parent_tool_use_id: 'subagent', message: { content: [{ type: 'text', text: 'not allowed' }] } },
  ])('rejects executable provider output immediately %#', async dangerous => {
    const f = fixture(), task = f.worker.request('prompt', new AbortController().signal)
    const rejection = expect(task).rejects.toThrow('tool action')
    f.init(); f.acknowledge(); f.event(dangerous)
    await rejection
    expect(f.terminate).toHaveBeenCalledTimes(1)
  })

  it('checks active tool surfaces without mistaking disabled plugin inventory for executable tools', async () => {
    const f = fixture(), task = f.worker.request('prompt', new AbortController().signal)
    f.init({ plugins: [{ name: 'disabled-inventory-item' }] }); f.acknowledge(); f.result()
    expect(await task).toBe('{"ok":true}')
    const second = f.worker.request('prompt', new AbortController().signal)
    const rejection = expect(second).rejects.toThrow('isolated text session')
    f.init({ tools: ['Bash'] })
    await rejection
  })

  it('stops on malformed data without echoing its contents', async () => {
    const f = fixture(), task = f.worker.request('prompt', new AbortController().signal)
    const rejection = expect(task).rejects.toThrow('malformed worker data')
    f.child.stdout.write('private-token-malformed-json\n')
    await rejection
  })

  it.each([
    { type: 'error', error: { message: 'private-provider-detail' } },
    { type: 'stream_event', event: { type: 'message_delta', delta: { stop_reason: 'max_tokens' } } },
  ])('rejects provider errors and truncation without waiting for the timeout %#', async event => {
    const f = fixture(), task = f.worker.request('prompt', new AbortController().signal)
    const rejection = expect(task).rejects.toThrow(/worker error|cut off/)
    f.init(); f.acknowledge(); f.event(event)
    await rejection
    expect(f.terminate).toHaveBeenCalledTimes(1)
  })

  it('rejects inconsistent streams and non-JSON final answers', async () => {
    for (const malformed of ['plain text', '{"ok":false}']) {
      const f = fixture(), task = f.worker.request('prompt', new AbortController().signal)
      const rejection = expect(task).rejects.toThrow(/JSON|match/)
      f.init(); f.acknowledge()
      f.event({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '{"ok":true}' } } })
      f.result({ result: malformed }); await rejection
    }
  })

  it('retires after bounded use and also expires idle sessions', async () => {
    const f = fixture(true, { idleMs: 10 })
    for (let i = 0; i < 8; i++) {
      const task = f.worker.request('prompt', new AbortController().signal)
      f.init(); f.acknowledge(); f.result(); await task
    }
    expect(f.worker.alive).toBe(false)
    const idle = fixture(true, { idleMs: 10 }), task = idle.worker.request('prompt', new AbortController().signal)
    idle.init(); idle.acknowledge(); idle.result(); await task
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(idle.worker.alive).toBe(false)
  })

  it('does not turn cancellation from a text callback into success', async () => {
    const f = fixture(), controller = new AbortController()
    const task = f.worker.request('prompt', controller.signal, () => controller.abort())
    const rejection = expect(task).rejects.toMatchObject({ name: 'AbortError' })
    f.init(); f.acknowledge(); f.result()
    await rejection
  })
})
