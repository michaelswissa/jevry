/** End-to-end acceptance: real Electron, saved providers, public 2048, disposable profile.
 * --run-live explicitly enables the two bounded model-driven turns.
 * Checks only observed DOM score, tutorial visibility and actual action receipts.
 */
import { _electron as electron } from '@playwright/test';
import electronPath from 'electron';
import { mkdtemp, copyFile, chmod, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { tmpdir, homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const live = process.argv.includes('--run-live');
const fixtures = process.argv.includes('--strategy-fixtures');
const winInputRegression = process.argv.includes('--win-input-regression');
const moveLimit = Number(process.argv.find(a => a.startsWith('--move-limit='))?.slice(13) || 8);
const continueToWin = process.argv.includes('--continue-to-win');
assert.ok(Number.isInteger(moveLimit) && moveLimit >= 8 && moveLimit <= 2500);
assert.ok(!continueToWin || winInputRegression);
assert.ok(!(fixtures && winInputRegression), 'Choose one acceptance scenario.');
const output = resolve(root, process.argv.find(a => a.startsWith('--output='))?.slice(9) || 'artifacts/live-game.json');
const profile = await mkdtemp(join(tmpdir(), 'jevry-live-game-'));
const connectionSource = process.env.JEVRY_CONNECTION_SOURCE || join(homedir(), 'Library', 'Application Support', 'Jevry', 'connections.enc');
const report = { generatedAt: new Date().toISOString(), liveInference: live, isolatedProfile: true, sourceHashes: {}, turns: [], passed: false };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const safeText = text => String(text || '').replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[redacted]').replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 6000);
let app, page, deadline, server;
let activeGameUrl = 'https://play2048.co/';

async function outcome() {
  return app.evaluate(async ({ webContents }, url) => {
    const wc = webContents.getAllWebContents().find(w => w.getURL() === url);
    if (!wc) return { missing: true };
    return globalThis.__jevGameInspect(wc, `(()=>{
      const label=[...document.querySelectorAll('span')].find(e=>e.textContent.trim()==='Score');
      const score=label?Number(label.parentElement.lastElementChild.textContent.replace(/,/g,'')):null;
      return {url:location.href,score,status:document.querySelector('[role="status"]')?.textContent,welcome:document.body.innerText.includes('Would you like to learn how to play?'),canvas:!!document.querySelector('canvas'),canvasTabIndex:document.querySelector('canvas')?.getAttribute('tabindex'),focusedTag:document.activeElement?.tagName,focusedText:document.activeElement?.textContent?.slice(0,80),display:window.__jevDisplayProbe,text:document.body.innerText.slice(0,1800)};
    })()`);
  }, activeGameUrl);
}
async function turn(text, previousScore, pursueVictory = false) {
  const started = performance.now();
  const accepted = await page.evaluate(text => window.jevry.sendMessage({ text, mode: 'auto' }), text);
  assert.equal(accepted.ok, true, accepted.message);
  let completed, intentionalStop = false, lastProgress = started;
  const eventLedger = new Map();
  const turnLimit = pursueVictory ? 1_200_000 : Math.max(150_000, moveLimit * 1800);
  while (performance.now() - started < turnLimit) {
    const state = await page.evaluate(() => window.jevry.state());
    const conversation = state.conversations.find(c => c.id === state.activeConversationId);
    const answer = conversation?.messages.find(m => m.replyTo === accepted.id);
    for (const event of answer?.events || []) eventLedger.set(JSON.stringify(event), event);
    if (performance.now() - lastProgress >= 15_000) {
      lastProgress = performance.now();
      const events = [...eventLedger.values()];
      const latest = await app.evaluate(() => globalThis.__jevGameTestStates?.at(-1)?.game?.board?.cells);
      console.log(JSON.stringify({ progress: text, elapsedMs: Math.round(lastProgress - started), keyInputs: events.filter(e => e.type === 'action' && /^KEY_/.test(e.operation)).length, visualReviews: events.filter(e => e.operation === 'GAME_REASONING').length, observedTile: latest ? Math.max(0, ...latest.flat().map(Number).filter(Number.isFinite)) : undefined, latestPhase: safeText(events.at(-1)?.message) }));
    }
    if (answer && !state.running && ['complete', 'error', 'stopped'].includes(answer.status)) { completed = answer; break; }
    // Bound the input regression without pretending that eight moves win 2048.
    if (winInputRegression && !pursueVictory && !intentionalStop && [...eventLedger.values()].filter(e => e.type === 'action' && /^KEY_/.test(e.operation)).length >= moveLimit && (await outcome()).score > previousScore) {
      intentionalStop = true;
      await page.evaluate(() => window.jevry.stop());
    }
    await pause(250);
  }
  if (!completed) {
    await page.evaluate(() => window.jevry.stop());
    let state = await page.evaluate(() => window.jevry.state());
    const draining = Date.now() + 5000;
    while (state.running && Date.now() < draining) { await pause(100); state = await page.evaluate(() => window.jevry.state()); }
    completed = state.conversations.find(c => c.id === state.activeConversationId)?.messages.find(m => m.replyTo === accepted.id);
    if (!completed) throw new Error('Game turn exceeded its bounded time limit.');
  }
  for (const event of completed.events || []) eventLedger.set(JSON.stringify(event), event);
  completed.events = [...eventLedger.values()];
  const observed = await outcome();
  const actions = completed.events.filter(e => e.type === 'action');
  const keys = actions.filter(e => /^KEY_/.test(e.operation));
  const record = { text, status: completed.status, intentionalStop, answer: safeText(completed.content), durationMs: Math.round(performance.now() - started),
    firstActionMs: actions[0]?.elapsedMs, firstGameKeyMs: keys[0]?.elapsedMs,
    keyInputs: keys.length, outcome: observed, phases: completed.events.map(e => ({ type: e.type, operation: e.operation, model: e.model, durationMs: e.durationMs, elapsedMs: e.elapsedMs, message: safeText(e.message) })) };
  const decisions = completed.events.filter(e => e.type === 'decision');
  const moveDecisions = decisions.filter(e => /^KEY_|^POINT$/.test(e.operation));
  record.performance = { visualReviews: completed.events.filter(e => e.operation === 'GAME_REASONING').length,
    decisionModels: [...new Set(decisions.map(e => e.model))],
    moveDecisionMs: moveDecisions.map(e => e.durationMs), nativeInputMs: actions.filter(e => /^KEY_|^POINT$/.test(e.operation)).map(e => e.durationMs) };
  record.performance.moveGapMs = keys.slice(1).map((event, i) => event.elapsedMs - keys[i].elapsedMs);
  record.gameStates = await app.evaluate(() => { const states = globalThis.__jevGameTestStates || []; globalThis.__jevGameTestStates = []; return states; });
  report.turns.push(record);
  const percentile=(values,p)=>values.length?[...values].sort((a,b)=>a-b)[Math.floor((values.length-1)*p)]:null;
  console.log(JSON.stringify({text,status:record.status,answer:record.answer,durationMs:record.durationMs,firstGameKeyMs:record.firstGameKeyMs,keyInputs:record.keyInputs,
    performance:{visualReviews:record.performance.visualReviews,decisionModels:record.performance.decisionModels,medianDecisionMs:percentile(record.performance.moveDecisionMs,.5),medianMoveGapMs:percentile(record.performance.moveGapMs,.5),p95MoveGapMs:percentile(record.performance.moveGapMs,.95),maxMoveGapMs:Math.max(0,...record.performance.moveGapMs)},outcome:observed}));
  const png = await app.evaluate(async ({ webContents }, url) => {
    const wc = webContents.getAllWebContents().find(w => w.getURL() === url);
    return wc ? (await wc.capturePage()).toPNG().toString('base64') : undefined;
  }, activeGameUrl);
  if (png) {
    const screenshot = output.replace(/\.json$/, '') + `-turn-${report.turns.length}.png`;
    await writeFile(screenshot, Buffer.from(png, 'base64')); record.screenshot = screenshot;
  }
  assert.equal(completed.status, winInputRegression && !pursueVictory ? 'stopped' : 'complete', safeText(completed.error));
  if (winInputRegression) {
    assert.equal(intentionalStop, !pursueVictory, 'Only the harness may stop after observing the required keys and increased score.');
    assert.ok(record.gameStates.length > 0 && record.gameStates.every(s => s.game.objective === 'win'), 'Both turns must use the winning objective.');
    assert.equal(observed.canvasTabIndex, null, 'Temporary canvas focusability must be restored.');
  }
  assert.ok(moveDecisions.length > 0 && moveDecisions.every(e => /jev/i.test(e.model || '')), 'Every move must be chosen by Jev.');
  assert.equal(observed.missing, undefined, 'The game page was not opened.');
  assert.equal(observed.welcome, false, 'Optional welcome tutorial was not dismissed.');
  if (pursueVictory) {
    assert.match(observed.text || '', /you (?:win|won)|victory|congratulations/i, 'No visible winning message was observed.');
  } else if (fixtures) {
    assert.match(observed.status || '', /^You win!/, 'The actual game did not reach its winning state.');
    assert.ok(completed.events.some(e => e.operation === 'GAME_REASONING'), 'No visual strategy was used.');
  } else {
    assert.ok(keys.length >= (winInputRegression ? moveLimit : 8), `Only ${keys.length} game-key inputs were dispatched.`);
    assert.ok(observed.score > previousScore, `Observed score ${observed.score} did not exceed ${previousScore}.`);
  }
  assert.ok(!completed.events.some(e => (winInputRegression ? ['blocked', 'error'] : ['blocked', 'error', 'stopped']).includes(e.type)), 'The executor did not finish successfully.');
  assert.ok(!/\b(?:if you|please|could you)\b.{0,90}\b(?:dismiss|manually|permission)\b/i.test(record.answer), 'The answer unnecessarily handed routine gameplay to the user.');
  return observed.score;
}

// Reproduce the user starting a game with focus still on a non-game button. Setup uses only
// observed page controls; the models choose and execute every subsequent game move.
async function preparePublicGame(continuing = false) {
  if (!continuing) {
    // Ad requests can outlive the playable document. Poll the actual board instead
    // of blocking the acceptance run on Electron's full-page load promise.
    await page.evaluate(url => { void window.jevry.navigate(url).catch(() => {}); }, activeGameUrl);
    const until = Date.now() + 30_000;
    while (!(await outcome()).canvas && Date.now() < until) await pause(200);
    assert.equal((await outcome()).canvas, true, 'The public game must load.');
  }
  return app.evaluate(async ({ webContents }, { url, continuing }) => {
    const wc = webContents.getAllWebContents().find(w => w.getURL() === url);
    async function control(kind, focusOnly = false) {
      const point = await globalThis.__jevGameInspect(wc, `(()=>{
        const buttons=[...document.querySelectorAll('button')];
        const e=${kind === 'dismiss' ? "buttons.find(e=>!e.textContent.trim()&&e.parentElement.textContent.includes('Would you like to learn how to play?'))" : "buttons.find(e=>e.textContent.trim()==='New Game')||buttons.find(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&!e.disabled&&getComputedStyle(e).visibility!=='hidden'})"};
        if(!e)return null;
        if(${focusOnly})e.focus({preventScroll:true});
        const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};
      })()`);
      if (!point) throw new Error('Observed public-game control missing: ' + kind);
      if (!focusOnly) {
        wc.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
        wc.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }
    if (!continuing && await globalThis.__jevGameInspect(wc, "document.body.innerText.includes('Would you like to learn how to play?')")) await control('dismiss');
    await control('non-game-button', true);
    await globalThis.__jevGameInspect(wc, `(()=>{
      window.__jevDisplayProbe={focusEvents:0,blurEvents:0};
      const canvas=document.querySelector('canvas');
      if(!canvas.dataset.jevDisplayProbe){canvas.dataset.jevDisplayProbe='true';
        canvas.addEventListener('focus',()=>window.__jevDisplayProbe.focusEvents++);
        canvas.addEventListener('blur',()=>window.__jevDisplayProbe.blurEvents++);
      }
    })()`);
    return globalThis.__jevGameInspect(wc, `({focusedTag:document.activeElement.tagName,focusedText:document.activeElement.textContent,canvasTabIndex:document.querySelector('canvas').getAttribute('tabindex')})`);
  }, { url: activeGameUrl, continuing });
}
try {
  await mkdir(dirname(output), { recursive: true });
  for (const file of ['desktop/engine.ts', 'desktop/snapshot.ts', 'desktop/chat-model.ts', 'desktop/game-strategy.ts', 'desktop/game-perception.ts', 'desktop/slide-merge.ts', 'desktop/numeric-ocr.ts', 'desktop/task-completion.ts', 'src/task-contract.ts', 'dist-desktop/main.cjs']) {
    report.sourceHashes[file] = createHash('sha256').update(await readFile(join(root, file))).digest('hex');
  }
  await copyFile(connectionSource, join(profile, 'connections.enc'));
  await chmod(join(profile, 'connections.enc'), 0o600);
  const env = { ...process.env, JEVRY_TEST_PROFILE: profile };
  delete env.ELECTRON_RUN_AS_NODE; delete env.JEVRY_DEV_URL;
  const packaged = process.env.JEVRY_PACKAGED_EXECUTABLE;
  app = await electron.launch({ args: packaged ? [] : [root], executablePath: packaged || electronPath, env, timeout: 30_000 });
  page = await app.firstWindow();
  await app.evaluate(() => {
    // Electron executeJavaScript waits for full load, even when a canvas is ready.
    // Test-owned DOM inspection uses CDP directly so stalled ad frames cannot hang setup.
    globalThis.__jevGameInspect = async (wc, expression) => {
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
      const { result, exceptionDetails } = await wc.debugger.sendCommand('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (exceptionDetails) throw new Error(exceptionDetails.text || 'Game inspection failed.');
      return result.value;
    };
    const original = globalThis.fetch;
    globalThis.__jevGameTestStates = [];
    globalThis.fetch = async (url, init) => {
      let recorded;
      if (String(url).startsWith('https://api.typesafe.ai/') && typeof init?.body === 'string') {
        try { const body = JSON.parse(init.body); if (body.state?.game) {
          recorded = { game: body.state.game, contract:body.state.taskContract, previousInputs:body.state.previousInputs, points: body.questions?.point_target?.criteria, recovery: body.state.game_input_recovery, availableOperations: Object.keys(body.questions.operation.criteria), estimatedValues: Object.fromEntries(Object.entries(body.questions.operation.criteria).filter(([,v])=>Number.isFinite(v.estimatedPositionValue)).map(([key,v])=>[key,v.estimatedPositionValue])) };
          globalThis.__jevGameTestStates.push(recorded);
        } } catch {}
      }
      const result = await original(url, init);
      if (recorded) { try { recorded.selected = (await result.clone().json()).answers?.operation?.choice; } catch {} }
      return result;
    };
  });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => typeof window.jevry?.state === 'function', undefined, { timeout: 15_000 });
  const state = await page.evaluate(() => window.jevry.state());
  report.providers = { textConnected: state.settings.text.connected, textProvider: state.settings.text.provider, textModel: state.settings.text.model,
    jevConnected: state.settings.jev.connected, jevModel: state.settings.jev.model };
  console.log(JSON.stringify({ providers: report.providers }));
  if (!live) report.status = 'status-only';
  else {
    assert.ok(state.settings.text.connected && state.settings.jev.connected, 'Both saved providers must be connected.');
    deadline = setTimeout(() => { void page.evaluate(() => window.jevry.stop()).catch(() => {}); }, continueToWin ? 1_600_000 : Math.max(320_000,moveLimit*4000));
    await page.evaluate(() => window.jevry.finishSetup());
    await page.evaluate(() => window.jevry.navigate('about:blank'));
    // Use the actual app layout. Forcing a second native view rectangle fights
    // BrowserPane's ResizeObserver and is not representative of the user's app.
    await page.locator('.browser-pane').waitFor({state:'visible'});
    await page.evaluate(() => window.jevry.newConversation());
    if (fixtures) {
      const games = Object.fromEntries(await Promise.all(['three-in-a-row', 'cross-the-road'].map(async name => [name, await readFile(join(root, 'tests/games', name + '.html'))])));
      server = createServer((req, res) => {
        const name = new URL(req.url, 'http://localhost').pathname.slice(1);
        const html = games[name]; res.writeHead(html ? 200 : 404, { 'content-type': 'text/html' }); res.end(html || 'Missing game');
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      report.scenario = 'live model reasoning on local canvas board-game and discrete arcade fixtures';
      const onlyGame = process.argv.find(a => a.startsWith('--game='))?.slice(7);
      for (const name of Object.keys(games).filter(name => !onlyGame || name === onlyGame)) {
        activeGameUrl = `http://127.0.0.1:${server.address().port}/${name}?seed=1`;
        await page.evaluate(url => window.jevry.navigate(url), activeGameUrl);
        await page.evaluate(() => window.jevry.newConversation());
        await turn('Win this game. Play from the current position and stop only when the game visibly says you won.', 0);
      }
    } else if (winInputRegression) {
      report.scenario = `Public 2048 win then continue, initially focused non-game button; first turn stops after ${moveLimit} inputs; follow-up ${continueToWin ? 'pursues victory' : 'also stops after '+moveLimit+' inputs'}`;
      report.initialFocus = await preparePublicGame();
      assert.equal(report.initialFocus.focusedTag, 'BUTTON');
      assert.equal(report.initialFocus.canvasTabIndex, null);
      assert.equal((await outcome()).welcome, false);
      const score = await turn('try to win this game', 0);
      report.continueFocus = await preparePublicGame(true);
      assert.equal(report.continueFocus.focusedTag, 'BUTTON');
      await turn('continue', score, continueToWin);
    } else {
      const score = await turn('show me how fast can you browse the web, enter a game and play it. Use https://play2048.co.', 0);
      await turn('play', score);
    }
    report.passed = true; report.status = 'passed';
  }
} catch (error) {
  report.status = 'failed-or-unavailable'; report.error = safeText(error.message); process.exitCode = 1;
  console.log(JSON.stringify({ status: report.status, error: report.error }));
} finally {
  clearTimeout(deadline);
  if (page) await page.evaluate(() => window.jevry.stop()).catch(() => {});
  if (app) await app.close().catch(() => {});
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
}
