import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { join } from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearProviderSession, generateFieldText, generatePlan, generateVisionPlan, getProviderDiagnostics, getProviderStatus, installProvider, loginProvider, stopProviderProcesses, validateTextConnection, type VisionImage } from './providers'

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), access: vi.fn(), mkdir: vi.fn(), realpath: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('node:fs/promises', async importOriginal => ({ ...await importOriginal<typeof import('node:fs/promises')>(), access: mocks.access, mkdir: mocks.mkdir, realpath: mocks.realpath }))

const pending: { stdout?: string; stderr?: string; code?: number; wait?: boolean }[] = []
let children: ReturnType<typeof childProcess>[] = []
function childProcess() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(),
    kill: vi.fn(), unref: vi.fn(), pid: undefined,
  })
  return child
}

function stream(data: unknown[], trailing = true): Response {
  const body = data.map(item => `data: ${JSON.stringify(item)}\r\n\r\n`).join('') + (trailing ? 'data: [DONE]\n\n' : '')
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
}

function response(text = '{"ok":true}') {
  return stream([{ choices: [{ delta: { content: text }, finish_reason: 'stop' }] }])
}

beforeEach(() => {
  pending.length = 0
  children = []
  mocks.access.mockResolvedValue(undefined)
  mocks.mkdir.mockResolvedValue(undefined)
  mocks.realpath.mockRejectedValue(new Error('ENOENT'))
  mocks.spawn.mockImplementation(() => {
    const child = childProcess()
    const next = pending.shift() || {}
    children.push(child)
    if (!next.wait) setTimeout(() => {
      if (next.stdout) child.stdout.write(next.stdout)
      if (next.stderr) child.stderr.write(next.stderr)
      child.emit('close', next.code ?? 0)
    }, 0)
    return child
  })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); mocks.spawn.mockReset(); mocks.access.mockReset(); mocks.mkdir.mockReset(); mocks.realpath.mockReset() })

describe('text connection status and login', () => {
  it('reports missing CLIs without running a shell', async () => {
    mocks.access.mockRejectedValue(new Error('ENOENT'))
    expect(await getProviderStatus('codex')).toMatchObject({ installed: false, authenticated: false })
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('does not expose credentials or account details from status output', async () => {
    pending.push({ stderr: 'Logged in using API key - sk-super-private-token' })
    const status = await getProviderStatus('codex')
    expect(status.authenticated).toBe(true)
    expect(JSON.stringify(status)).not.toContain('sk-super')
    expect(mocks.spawn.mock.calls[0][1]).toEqual(['login', 'status'])
    expect(mocks.spawn.mock.calls[0][2].shell).toBe(false)
  })

  it('requires Claude JSON to report an authenticated account', async () => {
    pending.push({ stdout: '{"loggedIn":false,"email":"private@example.com"}' })
    expect(await getProviderStatus('claude')).toMatchObject({ installed: true, authenticated: false })
  })

  it('runs explicit login, redacts progress, and verifies completion', async () => {
    pending.push({ stdout: 'Open https://example.com/login\naccess_token=private-token\n' }, { stdout: '{"loggedIn":true}' })
    const progress = vi.fn()
    await loginProvider('claude', progress)
    expect(mocks.spawn.mock.calls[0][1]).toEqual(['auth', 'login'])
    expect(progress.mock.calls.flat().join(' ')).toContain('[redacted]')
    expect(progress.mock.calls.flat().join(' ')).not.toContain('private-token')
    expect(progress.mock.calls.at(-1)?.[0]).toContain('connected')
  })
})

describe('Windows CLI discovery', () => {
  function windows(overrides: { arch?: string; env?: Record<string, string> } = {}) {
    vi.stubGlobal('process', {
      ...process,
      platform: 'win32', arch: overrides.arch || 'x64',
      execPath: 'C:\\Program Files\\Jevry\\Jevry.exe',
      env: { USERPROFILE: 'C:\\Users\\Test User', APPDATA: 'C:\\Users\\Test User\\AppData\\Roaming', ...overrides.env },
    })
  }
  function onlyExists(path: string) {
    mocks.access.mockImplementation(async (candidate: string) => {
      if (candidate !== path) throw new Error('ENOENT')
    })
  }

  it('runs an npm JS launcher using Electron as Node without a shell', async () => {
    windows()
    const launcher = 'C:\\Users\\Test User\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js'
    onlyExists(launcher)
    expect(await getProviderStatus('codex')).toMatchObject({ installed: true, authenticated: true })
    const [command, args, options] = mocks.spawn.mock.calls[0]
    expect(command).toBe('C:\\Program Files\\Jevry\\Jevry.exe')
    expect(args).toEqual([launcher, 'login', 'status'])
    expect(options.env.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(options.shell).toBe(false)
    expect(options.detached).toBe(false)
  })

  it('prefers npm’s native x64 binary over its JavaScript launcher', async () => {
    windows()
    const native = 'C:\\Users\\Test User\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe'
    onlyExists(native)
    expect((await getProviderStatus('codex')).authenticated).toBe(true)
    expect(mocks.spawn.mock.calls[0][0]).toBe(native)
    expect(mocks.spawn.mock.calls[0][1]).toEqual(['login', 'status'])
    expect(mocks.spawn.mock.calls[0][2].env.ELECTRON_RUN_AS_NODE).toBeUndefined()
  })

  it('finds nested npm ARM64 platform packages', async () => {
    windows({ arch: 'arm64' })
    const native = 'C:\\Users\\Test User\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-arm64\\vendor\\aarch64-pc-windows-msvc\\codex\\codex.exe'
    onlyExists(native)
    expect((await getProviderStatus('codex')).installed).toBe(true)
    expect(mocks.spawn.mock.calls[0][0]).toBe(native)
  })

  it('resolves a custom npm prefix from Windows Path without interpreting metacharacters', async () => {
    windows({ env: { Path: '"D:\\Tools & Models\\npm";C:\\Windows\\System32' } })
    const launcher = 'D:\\Tools & Models\\npm\\node_modules\\@openai\\codex\\bin\\codex.js'
    onlyExists(launcher)
    expect((await getProviderStatus('codex')).installed).toBe(true)
    expect(mocks.spawn.mock.calls[0][1][0]).toBe(launcher)
    expect(mocks.spawn.mock.calls[0][2].shell).toBe(false)
  })

  it('reuses an installed desktop app binary before asking for a CLI install', async () => {
    windows({ env: { LOCALAPPDATA: 'C:\\Users\\Test User\\AppData\\Local' } })
    const native = 'C:\\Users\\Test User\\AppData\\Local\\Programs\\Codex\\resources\\codex.exe'
    onlyExists(native)
    expect(await getProviderStatus('codex')).toMatchObject({ installed: true, authenticated: true })
    expect(mocks.spawn.mock.calls[0][0]).toBe(native)
  })

  it('finds the native Claude installation in the user bin directory', async () => {
    windows()
    const native = 'C:\\Users\\Test User\\.local\\bin\\claude.exe'
    onlyExists(native)
    pending.push({ stdout: '{"loggedIn":true}' })
    expect((await getProviderStatus('claude')).authenticated).toBe(true)
    expect(mocks.spawn.mock.calls[0][0]).toBe(native)
    expect(mocks.spawn.mock.calls[0][1]).toEqual(['auth', 'status', '--json'])
  })
})

describe('private CLI installation', () => {
  const tools = '/tmp/jevry-provider-test-tools'
  const npm = '/test/node_modules/npm/bin/npm-cli.js'
  const binaries = {
    codex: join(tools, 'node_modules', '@openai', 'codex-darwin-arm64', 'vendor', 'aarch64-apple-darwin', 'bin', 'codex'),
    claude: join(tools, 'node_modules', '@anthropic-ai', 'claude-code-darwin-arm64', 'claude'),
  }
  function setup() {
    vi.stubGlobal('process', { ...process, platform: 'darwin', arch: 'arm64', env: { JEVRY_TOOLS_DIR: tools, npm_execpath: npm } })
    const installed = new Set<string>()
    mocks.access.mockImplementation(async (path: string) => { if (path !== npm && !installed.has(path)) throw new Error('ENOENT') })
    const spawn = mocks.spawn.getMockImplementation()!
    mocks.spawn.mockImplementation((...args: any[]) => {
      if (args[1].includes('install')) {
        if (args[1].includes('@openai/codex')) installed.add(binaries.codex)
        if (args[1].includes('@anthropic-ai/claude-code')) installed.add(binaries.claude)
      }
      return spawn(...args)
    })
    return installed
  }

  it('installs only the selected fixed package privately with scripts disabled', async () => {
    setup()
    pending.push({ stdout: 'Downloading packages\naccess_token=hidden-value\n' }, { stdout: 'codex-cli 0.155.1' })
    const progress = vi.fn()
    await installProvider('codex', progress)
    const [command, args, options] = mocks.spawn.mock.calls[0]
    expect(command).toBe(process.execPath)
    expect(args).toEqual([npm, 'install', '--prefix', tools, '--global=false', '--save-exact', '--ignore-scripts', '--include=optional', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org', '@openai/codex'])
    expect(options.shell).toBe(false)
    expect(options.env.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(options.cwd).toBe(tools)
    expect(mocks.spawn.mock.calls[1].slice(0, 2)).toEqual([binaries.codex, ['--version']])
    expect(progress.mock.calls.flat().join(' ')).not.toContain('hidden-value')
    expect(mocks.mkdir).toHaveBeenCalledWith(tools, { recursive: true, mode: 0o700 })
  })

  it('resolves Claude’s optional native binary without running its postinstall', async () => {
    setup()
    await installProvider('claude', vi.fn())
    expect(mocks.spawn.mock.calls[0][1]).toContain('@anthropic-ai/claude-code')
    expect(mocks.spawn.mock.calls[1].slice(0, 2)).toEqual([binaries.claude, ['--version']])
  })

  it('installs on Windows through npm-cli.js rather than npm.cmd', async () => {
    const directory = 'C:\\Users\\Test User\\Jevry & Tools'
    const npmScript = 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js'
    const binary = `${directory}\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe`
    vi.stubGlobal('process', { ...process, platform: 'win32', arch: 'x64', env: { JEVRY_TOOLS_DIR: directory, Path: 'C:\\Program Files\\nodejs' } })
    let installed = false
    mocks.access.mockImplementation(async (path: string) => { if (path !== npmScript && !(installed && path === binary)) throw new Error('ENOENT') })
    const spawn = mocks.spawn.getMockImplementation()!
    mocks.spawn.mockImplementation((...args: any[]) => { if (args[1].includes('install')) installed = true; return spawn(...args) })
    await installProvider('codex', vi.fn())
    expect(mocks.spawn.mock.calls[0][1][0]).toBe(npmScript)
    expect(mocks.spawn.mock.calls[0][1]).toContain(directory)
    expect(mocks.spawn.mock.calls[0][2].shell).toBe(false)
    expect(mocks.spawn.mock.calls[1][0]).toBe(binary)
  })

  it('serializes two providers and shares duplicate installation requests', async () => {
    setup()
    await Promise.all([installProvider('codex', vi.fn()), installProvider('codex', vi.fn()), installProvider('claude', vi.fn())])
    expect(mocks.spawn.mock.calls.map(call => call[1].includes('install') ? call[1].at(-1) : '--version')).toEqual(['@openai/codex', '--version', '@anthropic-ai/claude-code', '--version'])
  })

  it('reuses an existing CLI without invoking npm', async () => {
    const installed = setup()
    installed.add(binaries.codex)
    await installProvider('codex', vi.fn())
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('provides Node.js and API-key alternatives when npm is unavailable', async () => {
    setup()
    mocks.access.mockRejectedValue(new Error('ENOENT'))
    await expect(installProvider('codex', vi.fn())).rejects.toThrow('Node.js LTS')
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('refuses relative tools directories and arbitrary package names', async () => {
    setup()
    process.env.JEVRY_TOOLS_DIR = 'relative-directory'
    await expect(installProvider('codex', vi.fn())).rejects.toThrow('tools directory')
    await expect(installProvider('other-package' as 'codex', vi.fn())).rejects.toThrow('Select Codex or Claude Code')
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('reports install failure without echoing npm errors containing secrets', async () => {
    setup()
    pending.push({ code: 1, stderr: 'secret-user-token' })
    await expect(installProvider('codex', vi.fn())).rejects.toThrow('installation failed')
    expect(mocks.spawn).toHaveBeenCalledTimes(1)
  })
})

describe('CLI text planning', () => {
  it('keeps prompts out of argv and isolates a Codex plan', async () => {
    pending.push({ stdout: '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"steps\\":[]}"}}\n' })
    const onText = vi.fn()
    expect(await generatePlan({ provider: 'codex' }, 'private task $(rm -rf /)', new AbortController().signal, onText)).toBe('{"steps":[]}')
    const [, args, options] = mocks.spawn.mock.calls[0]
    expect(args).toContain('--ignore-user-config')
    expect(args).toContain('features.shell_tool=false')
    expect(args).toContain('read-only')
    expect(args).not.toContain('private task $(rm -rf /)')
    expect(options.shell).toBe(false)
    expect(options.cwd).toContain('jevry-text-')
    expect(onText).toHaveBeenCalledWith('{"steps":[]}')
  })

  it('streams Claude deltas once and returns its final result', async () => {
    pending.push({ stdout: [
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '{"steps":[]}' } } },
      { type: 'result', subtype: 'success', is_error: false, result: '{"steps":[]}' },
    ].map(item => JSON.stringify(item)).join('\n') })
    const onText = vi.fn()
    expect(await generatePlan({ provider: 'claude' }, 'plan', new AbortController().signal, onText)).toBe('{"steps":[]}')
    expect(onText).toHaveBeenCalledTimes(1)
    const args = mocks.spawn.mock.calls[0][1]
    expect(args.slice(args.indexOf('--tools'), args.indexOf('--tools') + 2)).toEqual(['--tools', ''])
    expect(args).toContain('--safe-mode')
    expect(args).toContain('--strict-mcp-config')
  })

  it('stops a provider that reports a tool action', async () => {
    pending.push({ stdout: '{"type":"item.started","item":{"type":"command_execution"}}\n' })
    await expect(generatePlan({ provider: 'codex' }, 'plan', new AbortController().signal)).rejects.toThrow('attempted a tool action')
    expect(children[0].kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('cancels the subprocess without waiting for its timeout', async () => {
    pending.push({ wait: true })
    const controller = new AbortController()
    const plan = generatePlan({ provider: 'codex' }, 'plan', controller.signal)
    const rejection = expect(plan).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(children).toHaveLength(1))
    controller.abort()
    await rejection
    expect(children[0].kill).toHaveBeenCalledWith('SIGTERM')
    children[0].emit('close', null)
  })

  it('cancels a Windows launcher and its children using its exact process id', async () => {
    vi.stubGlobal('process', { ...process, platform: 'win32', env: { ...process.env, SystemRoot: 'C:\\Windows' } })
    pending.push({ wait: true })
    const controller = new AbortController()
    const plan = generatePlan({ provider: 'codex' }, 'plan', controller.signal)
    const rejection = expect(plan).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(children).toHaveLength(1))
    Object.assign(children[0], { pid: 54321 })
    controller.abort()
    await rejection
    expect(mocks.spawn.mock.calls[1].slice(0, 2)).toEqual(['C:\\Windows\\System32\\taskkill.exe', ['/PID', '54321', '/T', '/F']])
    expect(mocks.spawn.mock.calls[1][2].shell).toBe(false)
    expect(children[1].unref).toHaveBeenCalled()
  })

  it('turns incompatible CLI flags into an actionable update message', async () => {
    pending.push({ stderr: 'error: unexpected argument --ignore-user-config', code: 2 })
    await expect(generatePlan({ provider: 'codex' }, 'plan', new AbortController().signal)).rejects.toThrow('Update Codex')
  })
})

describe('API text planning', () => {
  it('streams OpenAI content and preserves an explicitly selected model', async () => {
    const fetch = vi.fn().mockResolvedValue(stream([
      { choices: [{ delta: { content: '{"steps":' } }] },
      { choices: [{ delta: { content: '[]}' }, finish_reason: 'stop' }] },
    ]))
    vi.stubGlobal('fetch', fetch)
    const onText = vi.fn()
    expect(await generatePlan({ provider: 'openai', apiKey: 'secret', model: 'custom-model' }, 'plan', new AbortController().signal, onText)).toBe('{"steps":[]}')
    expect(onText.mock.calls).toEqual([['{"steps":'], ['[]}']])
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(JSON.parse(init.body).model).toBe('custom-model')
    expect(init.headers.authorization).toBe('Bearer secret')
    expect(init.redirect).toBe('error')
  })

  it('handles SSE split across arbitrary byte boundaries', async () => {
    const bytes = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"שלום"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
    const body = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close() } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { headers: { 'content-type': 'text/event-stream' } })))
    expect(await generatePlan({ provider: 'openai', apiKey: 'secret' }, 'plan', new AbortController().signal)).toBe('שלום')
  })

  it('uses Anthropic headers and text-delta events', async () => {
    const fetch = vi.fn().mockResolvedValue(stream([
      { type: 'content_block_delta', delta: { type: 'text_delta', text: '{"ok":true}' } },
      { type: 'message_stop' },
    ], false))
    vi.stubGlobal('fetch', fetch)
    expect(await generatePlan({ provider: 'anthropic', apiKey: 'secret' }, 'plan', new AbortController().signal)).toBe('{"ok":true}')
    expect(fetch.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/messages')
    expect(fetch.mock.calls[0][1].headers['x-api-key']).toBe('secret')
  })

  it('rejects insecure remote URLs before sending a key', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(generatePlan({ provider: 'openai', apiKey: 'secret', baseUrl: 'http://remote.example/v1' }, 'plan', new AbortController().signal)).rejects.toThrow('HTTPS')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('allows a local compatible model without a key', async () => {
    const fetch = vi.fn().mockResolvedValue(response())
    vi.stubGlobal('fetch', fetch)
    await generatePlan({ provider: 'openai', model: 'local-model', baseUrl: 'http://localhost:1234/v1' }, 'plan', new AbortController().signal)
    expect(fetch.mock.calls[0][1].headers.authorization).toBeUndefined()
  })

  it('never copies provider error bodies containing keys into errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('your key secret is invalid', { status: 401 })))
    const result = await validateTextConnection({ provider: 'openai', apiKey: 'secret' })
    expect(result.ok).toBe(false)
    expect(result.message).not.toContain('secret')
    expect(result.message).toContain('rejected')
  })

  it('rejects incomplete and truncated streams', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(stream([{ choices: [{ delta: { content: '{"a":' } }] }], false))
      .mockResolvedValueOnce(stream([{ choices: [{ delta: { content: '{"a":' }, finish_reason: 'length' }] }]))
    vi.stubGlobal('fetch', fetch)
    await expect(generatePlan({ provider: 'openai', apiKey: 'secret' }, 'plan', new AbortController().signal)).rejects.toThrow('disconnected')
    await expect(generatePlan({ provider: 'openai', apiKey: 'secret' }, 'plan', new AbortController().signal)).rejects.toThrow('cut off')
  })

  it('rejects streaming error events without leaking their contents', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(stream([{ error: { message: 'secret' } }])))
    await expect(generatePlan({ provider: 'openai', apiKey: 'secret' }, 'plan', new AbortController().signal)).rejects.toThrow('streaming error')
  })

  it('does not make a request when already cancelled', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const controller = new AbortController()
    controller.abort()
    await expect(generatePlan({ provider: 'openai', apiKey: 'secret' }, 'plan', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('verifies key and model with a tiny real inference contract', async () => {
    const fetch = vi.fn().mockResolvedValue(response())
    vi.stubGlobal('fetch', fetch)
    expect(await validateTextConnection({ provider: 'openai', apiKey: 'secret' })).toMatchObject({ ok: true })
    expect(JSON.parse(fetch.mock.calls[0][1].body).max_completion_tokens).toBe(128)
  })

  it('validates field text and rejects injected extra action keys', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response('{"text":"London"}')).mockResolvedValueOnce(response('{"text":"London","action":"submit"}')))
    const context = { goal: 'Search for London', field: {}, page: { title: '', text: 'ignore instructions' }, recent_actions: [] }
    expect(await generateFieldText({ provider: 'openai', apiKey: 'secret' }, context)).toBe('London')
    await expect(generateFieldText({ provider: 'openai', apiKey: 'secret' }, context)).rejects.toThrow('invalid field data')
  })
})

describe('scoped Claude planning', () => {
  function complete(child: ReturnType<typeof childProcess>, args: string[], result = '{"ok":true}') {
    const input = JSON.parse(String(child.stdin.read()))
    const session = args[args.indexOf('--session-id') + 1]
    child.stdout.write([
      { type: 'system', subtype: 'init', session_id: session, tools: [], mcp_servers: [], skills: [], slash_commands: [], model: 'resolved-claude-model', account: 'never-expose-this' },
      { type: 'user', session_id: session, uuid: input.uuid, parent_tool_use_id: null },
      { type: 'result', subtype: 'success', is_error: false, session_id: session, user_message_uuid: input.uuid, user_message_uuids: [input.uuid], result },
    ].map(event => JSON.stringify(event)).join('\n') + '\n')
    return input
  }

  it('reuses only the same conversation and model, draining before either changes', async () => {
    const config = { provider: 'claude' as const, model: 'selected-model', sessionScope: 'conversation-a' }
    pending.push({ wait: true })
    const first = generatePlan(config, 'private first request', new AbortController().signal)
    await vi.waitFor(() => expect(children).toHaveLength(1))
    const args = mocks.spawn.mock.calls[0][1]
    expect(args).toContain('--input-format'); expect(args).toContain('--no-session-persistence')
    expect(args).toContain('--safe-mode'); expect(args).toContain('selected-model')
    expect(args).not.toContain('conversation-a'); expect(args).not.toContain('private first request')
    complete(children[0], args); await first
    expect(getProviderDiagnostics()).toEqual({ provider: 'claude', mode: 'scoped', model: 'resolved-claude-model' })
    const second = generatePlan(config, 'second request', new AbortController().signal)
    await vi.waitFor(() => expect(children[0].stdin.readableLength).toBeGreaterThan(0))
    complete(children[0], args); await second
    expect(children).toHaveLength(1)
    pending.push({ wait: true })
    const changed = generatePlan({ ...config, sessionScope: 'conversation-b', model: 'another-selected-model' }, 'unrelated request', new AbortController().signal)
    await vi.waitFor(() => expect(children[0].kill).toHaveBeenCalledWith('SIGTERM'))
    expect(children).toHaveLength(1)
    children[0].emit('close', null)
    await vi.waitFor(() => expect(children).toHaveLength(2))
    const next = complete(children[1], mocks.spawn.mock.calls[1][1]); await changed
    expect(next.message.content).toBe('unrelated request')
    expect(mocks.spawn.mock.calls[1][1]).toContain('another-selected-model')
    expect(mocks.spawn.mock.calls[1][2].cwd).not.toBe(mocks.spawn.mock.calls[0][2].cwd)
    children[1].emit('close', null)
  })

  it('drains a cancelled session and starts fresh on the next request', async () => {
    pending.push({ wait: true })
    const controller = new AbortController(), config = { provider: 'claude' as const, sessionScope: 'cancellation-scope' }
    const task = generatePlan(config, 'abandoned request', controller.signal)
    let rejected = false
    const rejection = expect(task).rejects.toMatchObject({ name: 'AbortError' }).then(() => { rejected = true })
    await vi.waitFor(() => expect(children).toHaveLength(1))
    controller.abort(); await Promise.resolve()
    expect(rejected).toBe(false)
    children[0].emit('close', null); await rejection
    pending.push({ wait: true })
    const next = generatePlan(config, 'new request', new AbortController().signal)
    await vi.waitFor(() => expect(children).toHaveLength(2))
    complete(children[1], mocks.spawn.mock.calls[1][1]); await next
    children[1].emit('close', null)
  })

  it('clears only the requested conversation and drains before deletion completes', async () => {
    pending.push({ wait: true })
    const config = { provider: 'claude' as const, sessionScope: 'delete-this-conversation' }
    const task = generatePlan(config, 'prompt', new AbortController().signal)
    await vi.waitFor(() => expect(children).toHaveLength(1))
    complete(children[0], mocks.spawn.mock.calls[0][1]); await task
    await clearProviderSession('another-conversation')
    expect(children[0].kill).not.toHaveBeenCalled()
    let cleared = false
    const clear = clearProviderSession(config.sessionScope).then(() => { cleared = true })
    await Promise.resolve()
    expect(children[0].kill).toHaveBeenCalledWith('SIGTERM')
    expect(cleared).toBe(false)
    children[0].emit('close', null); await clear
  })

  it('invalidates queued work before it can recreate a deleted conversation session', async () => {
    const task = generatePlan({ provider: 'claude', sessionScope: 'queued-for-deletion' }, 'prompt', new AbortController().signal)
    const rejected = expect(task).rejects.toMatchObject({ name: 'AbortError' })
    await clearProviderSession('queued-for-deletion')
    await rejected
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('falls back only after unsupported startup flags, without repeating ambiguous inference', async () => {
    pending.push({ wait: true }, { stdout: '{"type":"result","subtype":"success","is_error":false,"result":"{\\"ok\\":true}"}\n' })
    const task = generatePlan({ provider: 'claude', sessionScope: 'old-cli' }, 'harmless request', new AbortController().signal)
    await vi.waitFor(() => expect(children).toHaveLength(1))
    children[0].stderr.write('error: unknown option --input-format')
    children[0].emit('close', 1)
    expect(await task).toBe('{"ok":true}')
    expect(mocks.spawn.mock.calls[1][1]).not.toContain('--input-format')
    expect(mocks.spawn.mock.calls[1][1]).toContain('--safe-mode')
  })
})

describe('single-image provider requests', () => {
  const image: VisionImage = { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6G1sAAAAASUVORK5CYII=' }
  const signal = () => new AbortController().signal

  it.each(['openai', 'anthropic'] as const)('sends actual image bytes to the selected %s model without tools or hidden history', async provider => {
    const fetch = vi.fn().mockResolvedValue(provider === 'openai' ? response('{"action":"wait"}') : stream([
      { type: 'content_block_delta', delta: { type: 'text_delta', text: '{"action":"wait"}' } }, { type: 'message_stop' },
    ], false))
    vi.stubGlobal('fetch', fetch)
    expect(await generateVisionPlan({ provider, apiKey: 'private-key', model: 'chosen-vision-model', sessionScope: 'ignore-vision-scope' }, 'inspect', image, signal())).toBe('{"action":"wait"}')
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.model).toBe('chosen-vision-model')
    expect(body.tools).toBeUndefined()
    const content = body.messages.at(-1).content
    expect(content).toContainEqual({ type: 'text', text: 'inspect' })
    expect(content).toContainEqual(provider === 'openai'
      ? { type: 'image_url', image_url: { url: `data:image/png;base64,${image.data}` } }
      : { type: 'image', source: { type: 'base64', media_type: 'image/png', data: image.data } })
    expect(JSON.stringify(body)).not.toContain('ignore-vision-scope')
  })

  it.each([
    { mimeType: 'image/gif', data: 'AAAA' },
    { mimeType: 'image/png', data: 'invalid!base64' },
    { mimeType: 'image/png', data: 'AA==' },
    { mimeType: 'image/jpeg', data: image.data },
    { mimeType: 'image/jpeg', data: '/9j/2Q==' },
    { mimeType: 'image/png', data: `data:image/png;base64,${image.data}` },
    { mimeType: 'image/png', data: 'AAAA'.repeat(Math.ceil(5 * 1024 * 1024 / 3) + 1) },
  ])('rejects malformed, mismatched and oversized images before any provider call %#', async invalid => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    await expect(generateVisionPlan({ provider: 'openai', apiKey: 'private-key' }, 'inspect', invalid as VisionImage, signal())).rejects.toThrow(/PNG|JPEG|base64|5 MB|header/)
    expect(fetch).not.toHaveBeenCalled(); expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('does not retry an image failure as text and does not expose response secrets or image data', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(`private-key ${image.data}`, { status: 400 }))
    vi.stubGlobal('fetch', fetch)
    const failure = await generateVisionPlan({ provider: 'openai', apiKey: 'private-key' }, 'inspect', image, signal()).catch(error => error)
    expect(failure.message).toContain('rejected')
    expect(failure.message).not.toContain('private-key'); expect(failure.message).not.toContain(image.data)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('rejects tool-call output from a multimodal API without acting', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(stream([{ choices: [{ delta: { tool_calls: [{ function: { name: 'execute' } }] } }] }])))
    await expect(generateVisionPlan({ provider: 'openai', apiKey: 'private-key' }, 'inspect', image, signal())).rejects.toThrow('tool action')
  })

  it('does not expose malformed JSON response bytes or network error paths', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(image.data, { headers: { 'content-type': 'application/json' } }))
      .mockRejectedValueOnce(new Error(`/private/provider/path private-key ${image.data}`))
    vi.stubGlobal('fetch', fetch)
    await expect(generateVisionPlan({ provider: 'openai', apiKey: 'private-key' }, 'inspect', image, signal())).rejects.toThrow('malformed response data')
    const error = await generateVisionPlan({ provider: 'openai', apiKey: 'private-key' }, 'inspect', image, signal()).catch(error => error)
    expect(error.message).toBe('Could not reach the API. Check the base URL and your internet connection.')
  })

  it('honors the caller cancellation and enforces a 30-second API deadline', async () => {
    vi.useFakeTimers()
    try {
      const fetch = vi.fn().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })
      }))
      vi.stubGlobal('fetch', fetch)
      const controller = new AbortController()
      const task = generateVisionPlan({ provider: 'openai', apiKey: 'private-key' }, 'inspect', image, controller.signal)
      const cancelled = expect(task).rejects.toMatchObject({ name: 'AbortError' })
      controller.abort(); await cancelled
      const deadline = generateVisionPlan({ provider: 'openai', apiKey: 'private-key' }, 'inspect', image, signal())
      const timeout = expect(deadline).rejects.toThrow('30 seconds')
      await vi.advanceTimersByTimeAsync(30_000); await timeout
      const already = new AbortController(); already.abort()
      await expect(generateVisionPlan({ provider: 'openai' }, 'inspect', image, already.signal)).rejects.toMatchObject({ name: 'AbortError' })
      expect(fetch).toHaveBeenCalledTimes(2)
    } finally { vi.useRealTimers() }
  })

  it('uses one isolated Claude image worker and drains it before returning', async () => {
    pending.push({ wait: true })
    let settled = false
    const task = generateVisionPlan({ provider: 'claude', model: 'chosen-model', sessionScope: 'existing-chat' }, 'inspect', image, signal()).then(text => { settled = true; return text })
    await vi.waitFor(() => expect(children).toHaveLength(1))
    const args = mocks.spawn.mock.calls[0][1], child = children[0]
    const input = JSON.parse(String(child.stdin.read()))
    const session = args[args.indexOf('--session-id') + 1]
    expect(input.message.content).toContainEqual({ type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.data } })
    expect(args).toContain('--no-session-persistence'); expect(args).toContain('--safe-mode')
    expect(args).toContain('--tools'); expect(args).toContain('chosen-model')
    expect(args.join(' ')).not.toContain(image.data); expect(args).not.toContain('existing-chat')
    child.stdout.write([
      { type: 'system', subtype: 'init', session_id: session, tools: [], mcp_servers: [], skills: [], slash_commands: [] },
      { ...input },
      { type: 'result', subtype: 'success', is_error: false, session_id: session, user_message_uuid: input.uuid, user_message_uuids: [input.uuid], result: '{"action":"wait"}' },
    ].map(event => JSON.stringify(event)).join('\n') + '\n')
    await Promise.resolve()
    expect(child.kill).toHaveBeenCalledWith('SIGTERM'); expect(settled).toBe(false)
    child.emit('close', 0)
    expect(await task).toBe('{"action":"wait"}')
    expect(getProviderDiagnostics()?.mode).toBe('ephemeral')
    await expect(stat(mocks.spawn.mock.calls[0][2].cwd)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('never falls back to a text-only Claude request on unsupported image protocol', async () => {
    pending.push({ wait: true })
    const task = generateVisionPlan({ provider: 'claude' }, 'inspect', image, signal())
    const rejected = expect(task).rejects.toThrow('Update Claude Code')
    await vi.waitFor(() => expect(children).toHaveLength(1))
    children[0].stderr.write('unknown option --input-format')
    children[0].emit('close', 1)
    await rejected
    expect(mocks.spawn).toHaveBeenCalledTimes(1)
  })

  it('checks actual Codex image support before attempting model inference', async () => {
    pending.push({ stdout: 'Usage: codex exec [PROMPT]' })
    await expect(generateVisionPlan({ provider: 'codex' }, 'inspect', image, signal())).rejects.toThrow('does not support image attachments')
    expect(mocks.spawn.mock.calls[0][1]).toEqual(['exec', '--help'])
    expect(mocks.spawn).toHaveBeenCalledTimes(1)
  })

  it('passes Codex a private temporary image and drains cancellation before deleting it', async () => {
    pending.push({ stdout: '-i, --image <FILE>... Optional image(s)' }, { wait: true })
    const controller = new AbortController()
    let settled = false
    const task = generateVisionPlan({ provider: 'codex', model: 'chosen-model' }, 'inspect', image, controller.signal)
    const rejected = expect(task).rejects.toMatchObject({ name: 'AbortError' }).then(() => { settled = true })
    await vi.waitFor(() => expect(children).toHaveLength(2))
    const args = mocks.spawn.mock.calls[1][1]
    const imagePath = args[args.indexOf('--image') + 1]
    expect(args).toContain('--ephemeral'); expect(args).toContain('--ignore-user-config')
    expect(args).toContain('chosen-model'); expect(args).not.toContain(image.data)
    expect(await readFile(imagePath, 'base64')).toBe(image.data)
    // Windows stat exposes synthesized POSIX bits, not the file's access-control list.
    // Keep the real content, cancellation drainage, and deletion checks on every host.
    if (process.platform !== 'win32') expect((await stat(imagePath)).mode & 0o777).toBe(0o600)
    controller.abort(); await Promise.resolve()
    expect(settled).toBe(false); expect((await stat(imagePath)).isFile()).toBe(true)
    children[1].emit('close', null); await rejected
    await expect(stat(imagePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([false, true])('removes the Codex attachment after completed or failed inference (failure=%s)', async fail => {
    pending.push({ stdout: '-i, --image <FILE>...' }, { wait: true })
    const task = generateVisionPlan({ provider: 'codex' }, 'inspect', image, signal())
    const result = fail ? expect(task).rejects.toThrow('could not complete') : expect(task).resolves.toBe('{"action":"wait"}')
    await vi.waitFor(() => expect(children).toHaveLength(2))
    const args = mocks.spawn.mock.calls[1][1], path = args[args.indexOf('--image') + 1]
    if (fail) children[1].stderr.write(`provider error private-key ${image.data}`)
    else children[1].stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '{"action":"wait"}' } }) + '\n')
    children[1].emit('close', fail ? 1 : 0)
    await result
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('provider shutdown', () => {
  it('terminates in-flight work and prevents starting new subprocesses during quit', async () => {
    pending.push({ wait: true })
    const plan = generatePlan({ provider: 'codex' }, 'plan', new AbortController().signal)
    const rejection = expect(plan).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(children).toHaveLength(1))
    stopProviderProcesses()
    await rejection
    expect(children[0].kill).toHaveBeenCalledWith('SIGKILL')
    expect((await getProviderStatus('codex')).authenticated).toBe(false)
    expect(mocks.spawn).toHaveBeenCalledTimes(1)
  })
})
