/** Sequential, alternating, actual-model source comparison. Never runs inference on import. */
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir, access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const products = ['jevry', 'firecrawl-source'];
const taskIds = ['paris-two', 'london-same', 'result-question', 'compare-policies', 'research-followup'];

/** Match the source runner's exact Playwright import and launch options; no providers are loaded. */
export async function preflightBrowser(executableOverride = process.env.JEVRY_BROWSER_EXECUTABLE) {
  const { chromium } = await import('@playwright/test');
  const executablePath = executableOverride || chromium.executablePath();
  try {
    await access(executablePath, constants.X_OK);
    if (!(await stat(executablePath)).isFile()) throw new Error('Not an executable file.');
  } catch {
    throw new Error(`Firecrawl browser preflight: Chromium executable is unavailable at ${executablePath}. Set JEVRY_BROWSER_EXECUTABLE to an installed compatible Chromium executable or install the Playwright browser before running any live comparison.`);
  }
  const started = Date.now();
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: executableOverride || undefined, timeout: 15000 });
    const context = await browser.newContext({ viewport: { width: 1120, height: 780 } });
    const page = await context.newPage();
    await page.goto('about:blank', { timeout: 5000 });
    if (await page.evaluate(() => location.href) !== 'about:blank') throw new Error('Blank browser probe returned an unexpected page.');
    const browserVersion = browser.version();
    await context.close();
    await browser.close(); browser = undefined;
    return { ok: true, executablePath, explicitOverride: !!executableOverride, browserVersion, viewport: { width: 1120, height: 780 }, blankPageVerified: true, closed: true, durationMs: Date.now() - started, modelRequests: 0 };
  } catch (error) {
    throw new Error(`Firecrawl browser preflight could not launch, read and close disposable Chromium at ${executablePath}: ${error.message}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

export function distribution(values) {
  const sorted = values.filter(value => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  if (!sorted.length) return { n: 0, values: [], min: null, median: null, max: null };
  const middle = Math.floor(sorted.length / 2);
  return { n: sorted.length, values: [...values].filter(value => Number.isFinite(value) && value >= 0), min: sorted[0], median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2, max: sorted.at(-1) };
}

export function aggregateRuns(runs, repetitions = 3) {
  return Object.fromEntries(products.map(product => {
    const selected = runs.filter(run => run.product === product);
    const rows = [];
    for (let repetition = 1; repetition <= repetitions; repetition++) {
      const run = selected.find(item => item.repetition === repetition);
      for (const id of taskIds) {
        const row = run?.report?.turns?.find(turn => turn.id === id);
        rows.push({ repetition, id, ...(row || { passed: false, status: 'missing-result', error: run?.error || 'No task result was recorded.' }), artifact: run?.artifact });
      }
    }
    return [product, {
      expectedTurns: repetitions * taskIds.length,
      automaticPassed: rows.filter(row => row.passed === true).length,
      failedOrMissing: rows.filter(row => row.passed !== true).length,
      resolvedModels: [...new Set(selected.map(run => run.report?.provider?.resolvedModel).filter(Boolean))],
      tasks: Object.fromEntries(taskIds.map(id => {
        const subset = rows.filter(row => row.id === id);
        return [id, { expected: repetitions, automaticPassed: subset.filter(row => row.passed === true).length,
          // Keep failed attempt times visible; successful-only times have a separate explicit name.
          allRecordedAttemptMs: distribution(subset.map(row => row.durationMs)),
          automaticPassMs: distribution(subset.filter(row => row.passed === true).map(row => row.durationMs)),
          modelCalls: distribution(subset.map(row => row.modelCalls ?? row.textCalls)),
          atomicActions: distribution(subset.map(row => row.atomicActions)),
          outcomes: subset.map(row => ({ repetition: row.repetition, passed: row.passed === true, status: row.status, durationMs: row.durationMs, criteria: row.criteria, error: row.error, artifact: row.artifact })) }];
      })),
      manualReview: rows.filter(row => ['compare-policies', 'research-followup'].includes(row.id)).map(row => ({ repetition: row.repetition, id: row.id, automatedPassed: row.passed === true, status: 'pending-human-semantic-review', answer: row.answer, citations: row.citations, artifact: row.artifact })),
    }];
  }));
}

async function sourceSnapshot() {
  const files = [];
  const collect = async relative => {
    for (const item of await readdir(join(root, relative), { withFileTypes: true })) {
      const path = join(relative, item.name);
      if (item.isDirectory()) await collect(path);
      else if (item.isFile()) files.push(path);
    }
  };
  for (const directory of ['desktop', 'src', 'dist-desktop', 'dist', 'upstream/web-agent/agent-core/src']) await collect(directory);
  const protocol = JSON.parse(await readFile(join(root, 'tests/benchmarks/firecrawl-task-protocol.json'), 'utf8'));
  files.push('scripts/benchmark-jevry.mjs', 'scripts/benchmark-firecrawl.mjs', 'scripts/benchmark-matched.mjs', 'tests/benchmarks/firecrawl-evaluate.mjs', 'tests/benchmarks/firecrawl-task-protocol.json', 'package.json', 'upstream/web-agent/agent-core/pnpm-lock.yaml', ...Object.values(protocol.routes).map(file => `tests/benchmarks/${file}`));
  const hashes = {};
  for (const file of files.sort()) hashes[file] = createHash('sha256').update(await readFile(join(root, file))).digest('hex');
  return hashes;
}

export async function runOne(product, repetition, outputDirectory) {
  const artifact = join(outputDirectory, `${repetition}-${product}.json`);
  const script = product === 'jevry' ? 'scripts/benchmark-jevry.mjs' : 'scripts/benchmark-firecrawl.mjs';
  const args = [script, '--run-live', '--repeat=1', '--tasks=all', `--output=${artifact}`];
  if (product === 'firecrawl-source') args.push('--provider=claude', '--session-mode=warm');
  console.log(`Starting repetition ${repetition}: ${product}`);
  const started = Date.now();
  const processResult = await new Promise(resolveResult => {
    const child = spawn(process.execPath, args, { cwd: root, env: process.env, stdio: 'inherit' });
    child.once('error', error => resolveResult({ exitCode: null, error: error.message }));
    child.once('close', (exitCode, signal) => resolveResult({ exitCode, signal }));
  });
  let report, error = processResult.error;
  try { report = JSON.parse(await readFile(artifact, 'utf8')); }
  catch (readError) { error = `Runner produced no readable artifact: ${readError.message}`; }
  return { product, repetition, artifact, wallMsIncludingSetup: Date.now() - started, ...processResult, ...(error ? { error } : {}), ...(report ? { report } : {}) };
}

export async function main(argv = process.argv.slice(2)) {
  const argument = name => argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!argv.includes('--run-live')) throw new Error('Pass --run-live only after freezing the build. This runs six sequential real-model sessions, three per implementation.');
  const repetitions = Number(argument('repeat') || 3);
  if (repetitions !== 3) throw new Error('The matched protocol requires exactly three repetitions per implementation.');
  const outputDirectory = resolve(root, argument('output-dir') || `artifacts/matched-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await mkdir(outputDirectory, { recursive: true });
  if ((await readdir(outputDirectory)).some(file => file === 'comparison.json' || /^\d+-(?:jevry|firecrawl-source)\.json$/.test(file))) throw new Error('The output directory already contains comparison artifacts. Choose a fresh --output-dir so an old result cannot be mistaken for a new failed run.');
  const output = join(outputDirectory, 'comparison.json');
  let browserPreflight;
  try { browserPreflight = await preflightBrowser(); }
  catch (error) {
    await writeFile(output, JSON.stringify({ generatedAt: new Date().toISOString(), scope: 'No-inference environment preflight; no live runners started.', browserPreflight: { ok: false, error: error.message, modelRequests: 0 }, runs: [], warnings: [error.message] }, null, 2) + '\n');
    throw error;
  }
  const sourceHashesBefore = await sourceSnapshot();
  const study = { generatedAt: new Date().toISOString(), scope: 'Actual Jevry desktop versus actual unmodified Firecrawl source graph with declared local browser and model-protocol adapters; not a native Firecrawl product benchmark.',
    configuration: { repetitions, tasksPerRepetition: taskIds, provider: 'Claude CLI, low effort, configured default model, case-scoped worker', order: [['jevry', 'firecrawl-source'], ['firecrawl-source', 'jevry'], ['jevry', 'firecrawl-source']], initialBrowserSetupExcluded: true,
      platform: process.platform, architecture: process.arch, nodeVersion: process.version },
    notes: ['Every run is sequential; no competing benchmark inference. Each case gets a unique provider session scope, cleared at case end.',
      'Scoped Claude workers may retire after eight requests or 200k input characters. The full Firecrawl graph transcript is larger, so warm mode does not imply every call reuses a process.',
      'Jevry uses actual Electron plus Jev action inference. The Firecrawl source graph uses injected headless Chromium tools and a buffered real-Claude JSON tool-call bridge; it does not use Firecrawl cloud interact.',
      'The source toolkit may batch up to six generic observed atomic actions; Jevry uses its own Jev operation loop. Atomic actions and model calls are reported separately.',
      'Three repetitions are descriptive only. No p95, significance test, general fastest-browser claim, or whole-product superiority is inferred.',
      'Research answers require semantic review for correct price attribution, refundable recommendation, deadline, and citation support; automated counts alone are insufficient.'],
    browserPreflight, sourceHashesBefore, sourceHashesAfter: {}, sourceDrift: [], warnings: [], runs: [], aggregate: {} };
  const save = async () => { study.aggregate = aggregateRuns(study.runs, repetitions); await writeFile(output, JSON.stringify(study, null, 2) + '\n'); };
  for (let index = 0; index < repetitions; index++) {
    for (const product of study.configuration.order[index]) {
      const currentHashes = await sourceSnapshot();
      const changed = [...new Set([...Object.keys(sourceHashesBefore), ...Object.keys(currentHashes)])].filter(file => sourceHashesBefore[file] !== currentHashes[file]);
      if (changed.length) {
        study.sourceDrift = changed; study.warnings.push('Build/source changed during the comparison. Further runs stopped; completed results are preserved and cannot be treated as a frozen-build matched study.');
        study.sourceHashesAfter = currentHashes; await save(); process.exitCode = 1; return study;
      }
      const run = await runOne(product, index + 1, outputDirectory);
      study.runs.push(run);
      if (run.exitCode !== 0) study.warnings.push(`Repetition ${run.repetition} ${run.product} runner did not exit successfully (exit ${run.exitCode ?? 'unavailable'}${run.signal ? `, signal ${run.signal}` : ''}). Task criteria and lifecycle outcome are separate; see ${run.artifact}.`);
      if (run.report?.cleanup?.ok === false) study.warnings.push(`Repetition ${run.repetition} ${run.product} reported cleanup failure. Passed task criteria do not establish successful app shutdown; see ${run.artifact}.`);
      await save();
    }
  }
  study.sourceHashesAfter = await sourceSnapshot();
  study.sourceDrift = [...new Set([...Object.keys(sourceHashesBefore), ...Object.keys(study.sourceHashesAfter)])].filter(file => sourceHashesBefore[file] !== study.sourceHashesAfter[file]);
  if (study.sourceDrift.length) study.warnings.push('Build/source drift was detected; this is not a frozen-build matched comparison.');
  const modelNames = [...new Set(study.runs.map(run => run.report?.provider?.resolvedModel).filter(Boolean))];
  if (modelNames.length !== 1 || study.runs.some(run => !run.report?.provider?.resolvedModel)) study.warnings.push('A single matching resolved model was not verified across all six runs.');
  if (study.runs.some(run => run.product === 'jevry' && run.report?.provider?.text !== 'claude')) study.warnings.push('Jevry did not report the required Claude text provider for every run.');
  if (study.runs.some(run => run.report?.turns?.some(turn => turn.status === 'complete' && !turn.criteria))) study.warnings.push('At least one completed row is missing the shared evaluator criteria.');
  study.finishedAt = new Date().toISOString();
  await save();
  const automaticPassed = Object.values(study.aggregate).reduce((total, product) => total + product.automaticPassed, 0);
  console.log(JSON.stringify({ output, automaticPassed, expectedTurns: repetitions * taskIds.length * products.length, warnings: study.warnings, semanticReview: 'pending' }));
  if (automaticPassed !== repetitions * taskIds.length * products.length || study.warnings.length) process.exitCode = 1;
  return study;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
