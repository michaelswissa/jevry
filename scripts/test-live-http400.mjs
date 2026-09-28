/** Opt-in reproduction of a real TypeSafe context-limit rejection, followed by
 * the compact request and one native click chosen by Jev. Local synthetic page;
 * no scripted model answer, external website mutation, or benchmark claim. */
import assert from 'node:assert/strict';
import { chromium, _electron as electron } from '@playwright/test';
import electronPath from 'electron';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtemp, readFile, copyFile, chmod, mkdir, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';

assert(process.argv.includes('--run-live'), 'Use --run-live to authorize two paid Jev requests.');
const output = resolve(process.argv.find(arg => arg.startsWith('--output='))?.slice(9) || 'artifacts/issue-1/live-http400.json');
const root = resolve('.'), temporary = await mkdtemp(join(tmpdir(), 'jevry-http400-'));
const report = { startedAt: new Date().toISOString(), passed: false, isolatedProfile: true, attempts: [] };
let app, browser, server;
try {
  // Bundle app request construction/decoding without altering production files.
  const bundle = join(temporary, 'request.cjs');
  await symlink(join(root, 'node_modules'), join(temporary, 'node_modules'), 'junction');
  await build({ stdin: { contents: `export {buildJevRequest} from './desktop/engine'; export {compileJevWebActions,decodeJevWebAction} from './desktop/jev-web-actions'; export {READ_STATE} from './desktop/snapshot';`, resolveDir: root },
    bundle: true, platform: 'node', format: 'cjs', packages: 'external', outfile: bundle });
  const { READ_STATE, buildJevRequest, compileJevWebActions, decodeJevWebAction } = createRequire(import.meta.url)(bundle);
  const descriptions = Array.from({ length: 60 }, (_, i) => `Report ${i}: 2026-09-${String(i % 28 + 1).padStart(2, '0')} / ${i * 13429 + 3719} / ${i * 919 + 429}.`).join(' ');
  const html = `<form><p>${descriptions}</p><div style="display:grid;grid-template-columns:repeat(20,1fr);gap:1px">${Array.from({ length: 200 }, (_, i) => `<button type="button" data-report="${i}">Open report ${i}</button>`).join('')}</div></form><output id="result"></output><script>window.clicks=[];document.addEventListener('click',e=>{if(e.target.matches('button')){window.clicks.push({report:e.target.dataset.report,trusted:e.isTrusted});document.querySelector('output').textContent='Report '+e.target.dataset.report+' opened';}});</script>`;
  server = createServer((_, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/reports`);
  const snapshot = await page.evaluate(READ_STATE);
  const request = buildJevRequest(snapshot, 'Open report 179.', []);
  const compiled = compileJevWebActions(request.body);
  assert(compiled && request.body.state.sharedActionContexts);
  const before = structuredClone(compiled.body);
  for (const question of Object.values(before.questions)) {
    delete question.instructions.sharedContextRule;
    for (const option of Object.values(question.criteria)) {
      const ref = option.nearby_text?.state_ref;
      if (ref) option.nearby_text = before.state.sharedActionContexts[ref.split('.')[1]];
    }
  }
  delete before.state.sharedActionContexts;
  report.actions = snapshot.actions.length;
  report.beforeBytes = Buffer.byteLength(JSON.stringify(before));
  report.afterBytes = Buffer.byteLength(JSON.stringify(compiled.body));

  const profile = join(temporary, 'profile'); await mkdir(profile);
  await copyFile(process.env.JEVRY_CONNECTION_SOURCE || join(homedir(), 'Library/Application Support/Jevry/connections.enc'), join(profile, 'connections.enc'));
  await chmod(join(profile, 'connections.enc'), 0o600);
  const encrypted = (await readFile(join(profile, 'connections.enc'))).toString('base64');
  const env = { ...process.env, JEVRY_TEST_PROFILE: profile }; delete env.ELECTRON_RUN_AS_NODE; delete env.JEVRY_DEV_URL;
  app = await electron.launch({ executablePath: electronPath, args: [root], env, timeout: 30000 });
  const shell = await app.firstWindow();
  const status = await shell.evaluate(() => window.jevry.state());
  assert.equal(status.settings.text.provider, 'codex');
  assert.equal(status.settings.text.model, 'gpt-6-luna');
  report.textConnection = 'Saved Codex / gpt-6-luna (not invoked by this Jev-only regression)';

  for (const [name, body] of [['before', before], ['after', compiled.body]]) {
    const started = Date.now();
    const result = await app.evaluate(async ({ safeStorage }, { encrypted, body }) => {
      const config = JSON.parse(safeStorage.decryptString(Buffer.from(encrypted, 'base64'))).jev;
      // This test may only send the saved credential to its configured TypeSafe service.
      const endpoint = new URL(config.baseUrl);
      if (endpoint.origin !== 'https://api.typesafe.ai' || endpoint.pathname !== '/v1/systemone') throw Error('Expected saved TypeSafe endpoint.');
      const response = await fetch(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` }, body: JSON.stringify({ ...body, model: config.model }) });
      const data = await response.json();
      const result = { status: response.status, code: data?.detail?.error_type,
        ...(response.ok ? { answers: data.answers, model: data.model } : {}) };
      return JSON.parse(JSON.stringify(result).split(config.apiKey).join('[redacted]'));
    }, { encrypted, body });
    report.attempts.push({ phase: name, elapsedMs: Date.now() - started, ...result });
    console.log(JSON.stringify({ phase: name, status: result.status, code: result.code, bytes: name === 'before' ? report.beforeBytes : report.afterBytes }));
    if (name === 'before') {
      assert.equal(result.status, 400); assert.equal(result.code, 'max_tokens_exceeded');
    } else {
      assert.equal(result.status, 200);
      const decision = decodeJevWebAction(result, compiled, request);
      assert.equal(decision.action.label, 'Open report 179');
      // Dispatch only the decoded, observed target; never substitute the expected answer.
      const rect = decision.action.rect, x = rect.x + rect.w / 2, y = rect.y + rect.h / 2;
      const cdp = await page.context().newCDPSession(page);
      try {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
      } finally { await cdp.detach(); }
      report.receipts = await page.evaluate(() => window.clicks);
      report.result = await page.locator('#result').textContent();
      assert.deepEqual(report.receipts, [{ report: '179', trusted: true }]);
      assert.equal(report.result, 'Report 179 opened');
    }
  }
  report.passed = true;
} catch (error) {
  report.error = error.message; process.exitCode = 1;
  console.error(error.message);
} finally {
  await app?.close(); await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, output }));
}
