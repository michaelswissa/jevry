/**
 * Actual Chromium actions + actual Jevry/upstream Jev loops, deterministic
 * inference. These numbers are browser-loop overhead, NOT live AI latency.
 * Usage: node scripts/benchmark-comparison.mjs [--runs=5] [--output=path.json]
 */
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir, cpus, platform, arch } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const runs = Number(argument('runs') || 5);
if (!Number.isSafeInteger(runs) || runs < 1 || runs > 30) throw new Error('--runs must be an integer from 1 to 30');
const output = resolve(root, argument('output') || 'artifacts/benchmark-comparison.json');
const fixtures = join(root, 'tests/benchmarks');
const temporary = await mkdtemp(join(tmpdir(), 'jevry-comparison-'));
const bundle = join(temporary, 'engine.mjs');
const sourcePaths = ['desktop/engine.ts', 'desktop/snapshot.ts', 'desktop/providers.ts'];
const sourceHashes = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, createHash('sha256').update(await readFile(join(root, path))).digest('hex')])));
const measuredSourceHashes = await sourceHashes();
await build({ entryPoints: [join(root, 'desktop/engine.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'esm' });
const { AgentEngine } = await import(pathToFileURL(bundle).href);
const scenarios = ['form', 'stale-target', 'search-enter', 'open-shadow-search', 'nested-scroll'];
const html = Object.fromEntries(await Promise.all(scenarios.map(async name => [name, await readFile(join(fixtures, `${name === 'stale-target' ? 'form' : name}.html`))])));
const server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html[req.url.slice(1)] || html.form); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/form`;
const goal = 'Prepare preferences for Paris, Business cabin, traveler Ada. Add the traveler and review the preferences.';
const desired = 'Preferences ready: Paris / business / Ada';
const expectedText = scenario => scenario === 'nested-scroll' ? 'Opened destination 12' : ['search-enter', 'open-shadow-search'].includes(scenario) ? 'Available stays in London' : desired;
const taskGoal = scenario => scenario === 'nested-scroll' ? 'Open Destination 12' : ['search-enter', 'open-shadow-search'].includes(scenario) ? 'Search for stays in London' : goal;
const scenarioUrl = scenario => new URL(`/${scenario}`, url).href;
const browser = await chromium.launch({ headless: true, executablePath: process.env.JEVRY_BROWSER_EXECUTABLE || undefined });

function answer(criteria, choice) {
  if (!(choice in criteria)) throw new Error(`Unavailable fixture choice: ${choice}`);
  return { choice, confidence: 1, probabilities: Object.fromEntries(Object.keys(criteria).map(key => [key, key === choice ? 1 : 0])) };
}

/** Shared semantic policy. It only selects offered choices; no selectors reach an agent. */
function infer(body, scenario) {
  const text = body.state.page.text;
  const elements = body.state.elements;
  const destination = elements.find(element => element.label === 'Destination');
  const cabin = elements.find(element => element.label === 'Cabin');
  const traveler = elements.find(element => element.label === 'Traveler name');
  let operation, label;
  if (['search-enter', 'open-shadow-search'].includes(scenario)) {
    const field = elements.find(element => element.label === 'Search destinations');
    if (text.includes(expectedText(scenario))) operation = 'DONE';
    else if (!field) operation = 'BLOCKED';
    else if (field.value !== 'London') [operation, label] = ['TYPE_TEXT', 'Search destinations'];
    else if (body.questions.operation.criteria.PRESS_ENTER) [operation, label] = ['PRESS_ENTER', 'Submit Search destinations'];
    else operation = 'BLOCKED';
  } else if (scenario === 'nested-scroll') {
    if (text.includes(expectedText(scenario))) operation = 'DONE';
    else if (elements.some(element => element.label === 'Destination 12')) [operation, label] = ['CLICK', 'Destination 12'];
    else operation = Object.keys(body.questions.operation.criteria).find(key => key.startsWith('SCROLL_DOWN_')) || 'BLOCKED';
  } else if (text.includes(desired)) operation = 'DONE';
  else if (destination?.value !== 'Paris') [operation, label] = ['TYPE_TEXT', 'Destination'];
  else if (cabin?.value !== 'Business') [operation, label] = ['SELECT', 'Cabin → Business'];
  else if (!traveler) [operation, label] = ['CLICK', 'Add traveler'];
  else if (traveler.value !== 'Ada') [operation, label] = ['TYPE_TEXT', 'Traveler name'];
  else [operation, label] = ['CLICK', 'Review preferences'];
  const answers = { operation: answer(body.questions.operation.criteria, operation) };
  if (label) {
    const name = `${operation.toLowerCase()}_target`;
    const criteria = body.questions[name]?.criteria;
    if (!criteria) throw new Error(`No ${operation} targets offered`);
    const target = Object.entries(criteria).find(([, entry]) => entry.element.replace(/^\[.*?\] /, '') === label)?.[0];
    if (!target) throw new Error(`Required observed target missing: ${label}`);
    answers[name] = answer(criteria, target);
  }
  return { answers, model: 'deterministic-fixture', usage: {} };
}

function fieldText(context) {
  if (context.field.label === 'Search destinations') return 'London';
  if (context.field.label === 'Destination') return 'Paris';
  if (context.field.label === 'Traveler name') return 'Ada';
  throw new Error(`Unexpected fixture field: ${context.field.label}`);
}

async function fixturePage(scenario) {
  const context = await browser.newContext({ viewport: { width: 1120, height: 780 } });
  const page = await context.newPage();
  await page.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort());
  await page.goto(scenarioUrl(scenario));
  const session = await context.newCDPSession(page);
  return { context, page, session };
}

function inferenceAdapter(page, scenario) {
  let replaced = false;
  return async body => {
    const response = infer(body, scenario);
    if (scenario === 'stale-target' && !replaced && response.answers.operation.choice === 'CLICK') {
      replaced = true;
      // Change observed identity between prediction and execution, retaining
      // its label. A valid recovery must refresh before the one real click.
      await page.evaluate(() => {
        const old = document.querySelector('#add');
        const next = old.cloneNode(true);
        next.onclick = old.onclick;
        old.replaceWith(next);
      });
    }
    return response;
  };
}

async function outcome(page) {
  return page.evaluate(() => ({ text: (document.querySelector('#result') || document.querySelector('search-widget')?.shadowRoot?.querySelector('#result'))?.textContent, receipts: window.benchmarkReceipts }));
}

async function runJevry(scenario) {
  const { context, page, session } = await fixturePage(scenario);
  const { frameTree } = await session.send('Page.getFrameTree');
  const { executionContextId } = await session.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'benchmark' });
  let cdpCalls = 0, textCalls = 0;
  const cdp = async (method, params) => { cdpCalls++; return session.send(method, params); };
  const events = [];
  const predict = inferenceAdapter(page, scenario);
  const engine = new AgentEngine({
    evaluate: async expression => {
      const response = await cdp('Runtime.evaluate', { expression, contextId: executionContextId, returnByValue: true, awaitPromise: true });
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
      return response.result.value;
    },
    cdp, url: () => page.url(), navigate: async address => { await page.goto(address); },
  }, event => events.push(event), {
    infer: async (_, body) => predict(body),
    fieldText: async (_, context) => { textCalls++; return fieldText(context); },
  });
  try {
    const started = performance.now();
    const result = await engine.run({ goal: taskGoal(scenario), jevConfig: { apiKey: 'offline-benchmark' }, textConfig: { provider: 'openai' } });
    return { competitor: 'jevry', scenario, ...result, elapsedMs: performance.now() - started, textCalls, cdpCalls,
      operations: events.filter(event => event.type === 'action').map(event => event.operation), outcome: await outcome(page) };
  } finally { await context.close(); }
}

async function runUpstream(scenario) {
  const { context, page, session } = await fixturePage(scenario);
  let cdpCalls = 0;
  const predict = inferenceAdapter(page, scenario);
  // Clean environment: only launch essentials. No inherited model credentials.
  const child = spawn(process.env.JEVRY_PYTHON || 'python3', [join(fixtures, 'upstream-jev-adapter.py')], {
    env: { PATH: process.env.PATH, LANG: 'en_US.UTF-8', PYTHONUNBUFFERED: '1' }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '', result;
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const exit = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
  child.stdin.write(`${JSON.stringify({ upstream: join(root, 'upstream/jev-ultrafast'), url: scenarioUrl(scenario), goal: taskGoal(scenario) })}\n`);
  try {
    for await (const line of createInterface({ input: child.stdout })) {
      const request = JSON.parse(line);
      if (request.kind === 'result') { result = request.value; continue; }
      try {
        let value;
        if (request.kind === 'loop-start') { cdpCalls = 0; value = true; }
        else if (request.kind === 'infer') value = await predict(request.body);
        else if (request.kind === 'field') value = fieldText(request.context);
        else if (request.kind === 'cdp') {
          cdpCalls++;
          if (request.method === 'Target.createTarget') value = { targetId: 'fixture-page' };
          else if (request.method === 'Target.attachToTarget') value = { sessionId: 'fixture-session' };
          else if (request.method === 'Target.closeTarget') value = { success: true };
          else if (request.method === 'Page.navigate') { await page.goto(request.params.url); value = {}; }
          else value = await session.send(request.method, request.params);
        } else throw new Error(`Unexpected bridge method: ${request.kind}`);
        child.stdin.write(`${JSON.stringify({ value })}\n`);
      } catch (error) { child.stdin.write(`${JSON.stringify({ error: error.message })}\n`); }
    }
    const code = await exit;
    if (code !== 0 || !result) throw new Error(`Upstream fixture failed (${code}): ${stderr}`);
    return { competitor: 'jev-ultrafast', scenario, ...result, cdpCalls, outcome: await outcome(page) };
  } finally { clearTimeout(timer); child.kill(); await context.close(); }
}

const records = [];
const commit = repo => execFileSync('git', ['-C', join(root, 'upstream', repo), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
try {
  // Alternate order to reduce warm-browser ordering bias. Initial navigation
  // is outside both timings; Python bridge cost remains non-comparable.
  for (const scenario of scenarios) for (let index = 0; index < runs; index++) {
    for (const run of index % 2 ? [runUpstream, runJevry] : [runJevry, runUpstream]) {
      const record = await run(scenario);
      record.repeat = index + 1;
      record.passed = ['done', 'complete'].includes(record.status) && record.outcome.text === expectedText(scenario);
      if (['form', 'stale-target'].includes(scenario)) record.passed &&= record.outcome.receipts.add === 1 && record.outcome.receipts.review === 1 && record.steps === 5 && record.modelCalls === (scenario === 'form' ? 6 : 7) && record.textCalls === 2;
      else if (scenario === 'nested-scroll') record.passed &&= record.outcome.receipts.open === 1;
      else record.passed &&= record.outcome.receipts.search === 1 && record.steps === 2 && record.textCalls === 1;
      records.push(record);
      console.log(`${record.competitor} ${scenario} ${index + 1}/${runs}: ${record.passed ? 'PASS' : 'FAIL'}; ${record.steps} actions; ${Math.round(record.elapsedMs)} ms offline loop`);
    }
  }
  const median = numbers => { const sorted = [...numbers].sort((a, b) => a - b); const i = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2; };
  const report = {
    generatedAt: new Date().toISOString(), kind: 'offline-browser-loop-comparison', liveInference: false,
    disclosure: 'Deterministic policy and field values; real Chromium input and actual source loops. Not an AI quality, end-to-end live latency, conversation, research, or superiority benchmark. Both timings exclude initial navigation; upstream also excludes its constructor observation and focus emulation. Upstream bridge adds Python↔Node IPC; Jevry uses in-process CDP. Raw elapsed time is not a fair speed ranking.',
    environment: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model, node: process.version, chromium: browser.version(), runs },
    commits: Object.fromEntries(['jev-ultrafast', 'web-agent', 'ego-lite'].map(repo => [repo, commit(repo)])),
    jevrySourceSha256: measuredSourceHashes,
    task: { goal, expectedOutcome: desired, expectedActions: 5, expectedDecisionCalls: 6, expectedFieldCalls: 2 },
    summaries: scenarios.flatMap(scenario => ['jevry', 'jev-ultrafast'].map(competitor => { const rows = records.filter(row => row.competitor === competitor && row.scenario === scenario); return { competitor, scenario, passed: rows.filter(row => row.passed).length, total: rows.length, medianOfflineLoopMs: median(rows.map(row => row.elapsedMs)), medianCdpCalls: median(rows.map(row => row.cdpCalls)) }; })),
    notRun: [
      { competitor: 'web-agent', reason: 'Live Firecrawl service and model required for the supplied research/interact stack. No paid or remote model calls made; a mocked Firecrawl service would not establish product quality.' },
      { competitor: 'ego-lite', reason: 'Open-source repo excludes the browser. The required closed-source globalThis.ego runtime is unavailable; a FakeEgo run would not measure the actual product.' },
    ], records,
  };
  await mkdir(dirname(output), { recursive: true });
  if (JSON.stringify(await sourceHashes()) !== JSON.stringify(measuredSourceHashes)) throw new Error('Runtime source changed during the comparison. Rerun to obtain a report tied to one source version.');
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Saved ${output}`);
  if (records.some(record => !record.passed && (record.competitor === 'jevry' || ['form', 'stale-target'].includes(record.scenario)))) process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
