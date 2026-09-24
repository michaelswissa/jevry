/**
 * Real Electron + saved real providers, isolated profile and local website.
 * Copies encrypted connection bytes only. Prints no credential values.
 * Default inspects public status; --run-live authorizes bounded provider calls.
 */
import { _electron as electron } from '@playwright/test';
import electronPath from 'electron';
import { createServer } from 'node:http';
import { mkdtemp, copyFile, chmod, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir, homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { extractFile } = createRequire(import.meta.url)('@electron/asar');
const live = process.argv.includes('--run-live');
const outputArg = process.argv.find(arg => arg.startsWith('--output='))?.slice('--output='.length);
const outputPath = resolve(root, outputArg || 'artifacts/live-conversation.json');
const profile = await mkdtemp(join(tmpdir(), 'jevry-live-conversation-'));
const connectionSource = process.env.JEVRY_CONNECTION_SOURCE || join(homedir(), 'Library', 'Application Support', 'Jevry', 'connections.enc');
const fixture = `<!doctype html><html lang="en"><head><title>Local stay search</title><style>body{font:18px system-ui;padding:35px}input,select,button{font:inherit;padding:8px;margin:12px}label{display:block}</style></head><body><h1>Find a stay</h1><p>Local test only. No booking, payment or external action is performed.</p><form><label for="destination">Destination</label><input id="destination" value="Berlin"><label for="guests">Guests</label><select id="guests"><option value="1">1 guest</option><option value="2">2 guests</option></select><button type="submit">Find stays</button></form><p id="results" role="status">Awaiting a search</p><script>window.receipts=[];document.querySelector('form').onsubmit=e=>{e.preventDefault();const result={destination:document.querySelector('input').value,guests:document.querySelector('select').value};window.receipts.push(result);document.querySelector('#results').textContent='Stays in '+result.destination+' for '+result.guests+' guests';}</script></body></html>`;
const server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(fixture); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const fixtureUrl = `http://127.0.0.1:${server.address().port}/fixture`;
const report = { generatedAt: new Date().toISOString(), liveInference: live, isolatedProfile: true, sourceHashes: {}, publicStatus: {}, turns: [], passed: false };
let app, page, deadline;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function safeText(text) {
  return String(text || '').replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[redacted]').replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 6000);
}
async function readOutcome() {
  return app.evaluate(async ({ webContents }, url) => {
    const wc = webContents.getAllWebContents().find(w => w.getURL() === url);
    if (!wc) return { missing: true };
    return wc.executeJavaScript('({result:document.querySelector("#results").textContent,destination:document.querySelector("#destination").value,guests:document.querySelector("#guests").value,receipts:window.receipts})');
  }, fixtureUrl);
}

async function turn(text, expectedDestination) {
  const started = performance.now();
  const accepted = await page.evaluate(text => window.jevry.sendMessage({ text, mode: 'auto' }), text);
  assert.equal(accepted.ok, true, accepted.message);
  let firstVisibleMs, firstActionMs, completed;
  while (performance.now() - started < 150_000) {
    const state = await page.evaluate(() => window.jevry.state());
    const conversation = state.conversations.find(c => c.id === state.activeConversationId);
    const answer = conversation?.messages.find(m => m.replyTo === accepted.id);
    if (answer?.content && firstVisibleMs === undefined) firstVisibleMs = Math.round(performance.now() - started);
    if (answer?.events.some(e => e.type === 'action') && firstActionMs === undefined) firstActionMs = Math.round(performance.now() - started);
    if (answer && !state.running && ['complete', 'error', 'stopped'].includes(answer.status)) { completed = { answer, conversation }; break; }
    await pause(250);
  }
  if (!completed) throw new Error('Live conversation turn exceeded its 150-second limit.');
  const outcome = await readOutcome();
  const answer = completed.answer;
  const record = { text, status: answer.status, answer: safeText(answer.content), error: safeText(answer.error), durationMs: Math.round(performance.now() - started), firstVisibleMs, firstActionMs,
    actions: answer.events.filter(e => e.type === 'action').map(e => ({ operation: e.operation, message: safeText(e.message) })), outcome,
    phases: answer.events.map(e => ({ type: e.type, operation: e.operation, durationMs: e.durationMs, elapsedMs: e.elapsedMs, message: safeText(e.message) })),
    transcriptMessages: completed.conversation.messages.length };
  report.turns.push(record);
  console.log(JSON.stringify({ turn: report.turns.length, status: record.status, durationMs: record.durationMs, answer: record.answer, outcome }));
  assert.equal(answer.status, 'complete', record.error);
  assert.ok(!answer.events.some(e=>['blocked','error'].includes(e.type)), 'The executor did not accept the actual completed outcome.');
  assert.equal(outcome.destination, expectedDestination);
  assert.equal(outcome.guests, '2');
  assert.equal(outcome.result, `Stays in ${expectedDestination} for 2 guests`);
  return record;
}

try {
  for (const file of ['dist-desktop/main.cjs', 'desktop/task-completion.ts', 'desktop/engine.ts', 'desktop/chat-model.ts']) {
    report.sourceHashes[file] = createHash('sha256').update(await readFile(join(root, file))).digest('hex');
  }
  try {
    await copyFile(connectionSource, join(profile, 'connections.enc'));
    await chmod(join(profile, 'connections.enc'), 0o600);
  } catch { throw new Error('The encrypted Jevry connection file was unavailable. No credentials were read.'); }
  const env = { ...process.env, JEVRY_TEST_PROFILE: profile };
  delete env.ELECTRON_RUN_AS_NODE; delete env.JEVRY_DEV_URL;
  const packaged=process.env.JEVRY_PACKAGED_EXECUTABLE;
  app = await electron.launch({ args: packaged?[]:[root], executablePath: packaged||electronPath, env, timeout: 30_000 });
  page = await app.firstWindow();
  report.packagedExecutable = packaged || null;
  const appPath = await app.evaluate(({ app }) => app.getAppPath());
  const runtimeBundle = appPath.endsWith('.asar') ? extractFile(appPath, 'dist-desktop/main.cjs') : await readFile(join(appPath, 'dist-desktop/main.cjs'));
  report.runtimeBundleSha256 = createHash('sha256').update(runtimeBundle).digest('hex');
  assert.equal(report.runtimeBundleSha256, report.sourceHashes['dist-desktop/main.cjs'], 'The launched app must contain the current compiled runtime.');
  await page.waitForLoadState('domcontentloaded');
  assert.equal(await page.evaluate(() => typeof window.jevry.sendMessage), 'function', 'Build the conversation runtime before running this script.');
  const state = await page.evaluate(() => window.jevry.state());
  report.publicStatus = { textConnected: state.settings.text.connected, textProvider: state.settings.text.provider, textModel: state.settings.text.model,
    jevConnected: state.settings.jev.connected, jevModel: state.settings.jev.model };
  console.log(JSON.stringify({ publicStatus: report.publicStatus }));
  if (!live) report.status = 'status-only';
  else {
    if (!state.settings.jev.connected) throw new Error('No saved Jev connection is available in the isolated profile.');
    if (!state.settings.text.connected) {
      const status = await page.evaluate(() => window.jevry.status('codex'));
      report.publicStatus.codexInstalled = status.installed;
      report.publicStatus.codexAuthenticated = status.authenticated;
      if (!status.installed || !status.authenticated) throw new Error('No connected text provider or authenticated Codex CLI is available.');
      const connected = await page.evaluate(() => window.jevry.connectText({ provider: 'codex' }));
      assert.equal(connected.ok, true, safeText(connected.message));
    }
    deadline = setTimeout(() => { void page.evaluate(() => window.jevry.stop()).catch(() => {}); }, 360_000);
    await page.evaluate(() => window.jevry.finishSetup());
    await page.evaluate(url => window.jevry.navigate(url), fixtureUrl);
    await page.locator('.browser-pane').waitFor({state:'visible'});
    for (let attempt = 0; attempt < 40; attempt++) {
      const ready = await readOutcome().catch(() => null);
      if (ready && !ready.missing) break;
      await pause(100);
    }
    await page.evaluate(() => window.jevry.newConversation());
    await turn('Find stays in Paris for two guests using this form. Stop when its search result is visible.', 'Paris');
    await turn('Now change it to London, keeping the same number of guests, and search again.', 'London');
    const last = await turn('What result did you get, and how many guests did we keep?', 'London');
    assert.match(last.answer, /London/i);
    assert.match(last.answer, /\b2\b|\btwo\b/i);
    assert.equal(last.actions.length, 0, 'A question about the current result should not mutate the page.');
    assert.equal(last.transcriptMessages, 6);
    // The profile is still temporary; verify persistence by reopening it.
    await app.close(); app = undefined;
    app = await electron.launch({ args: packaged ? [] : [root], executablePath: packaged || electronPath, env, timeout: 30_000 });
    page = await app.firstWindow();
    const restored = await page.evaluate(() => window.jevry.state());
    const messages = restored.conversations.find(c => c.id === restored.activeConversationId)?.messages || [];
    assert.equal(messages.length, 6);
    report.persistencePassed = true; report.passed = true; report.status = 'passed';
  }
} catch (error) {
  report.status = 'failed-or-unavailable'; report.error = safeText(error.message); process.exitCode = 1;
  console.log(JSON.stringify({ status: report.status, error: report.error }));
} finally {
  clearTimeout(deadline);
  if (page) await page.evaluate(() => window.jevry.stop()).catch(() => {});
  if (app) await app.close().catch(() => {});
  await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
}
