// Real app, Electron input, navigation and cancellation; only model responses are
// local deterministic fixtures. This is regression evidence, not a model score.
import { _electron as electron, expect } from '@playwright/test';
import electronPath from 'electron';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const profile = await mkdtemp(join(tmpdir(), 'jevry-owned-navigation-'));
const requests = [], foreignRequests = [], recoveryRequests = [], held = new Map();
const html = body => `<!doctype html><title>Navigation fixture</title><style>body{font:18px sans-serif;margin:36px}a,button{display:block;margin:20px 0;padding:12px}</style>${body}`;
const resultPage = html('<h1>Report page</h1><button onclick="document.querySelector(\'output\').textContent=\'Fixture result revealed\';this.disabled=true">Reveal result</button><output role="status">Result not revealed</output>');
const choice = (criteria, selected) => {
  assert(selected && Object.hasOwn(criteria, selected), 'The fixture must choose an offered alternative');
  return { choice: selected, confidence: 1, probabilities: Object.fromEntries(Object.keys(criteria).map(id => [id, Number(id === selected)])) };
};
const foreign = createServer((req, res) => { foreignRequests.push(req.url); res.end(html('Disallowed destination')); });
await new Promise(resolve => foreign.listen(0, '127.0.0.1', resolve));
const outside = `http://127.0.0.1:${foreign.address().port}`;
const server = createServer(async (req, res) => {
  try {
    requests.push({ method: req.method, path: req.url, referrer: req.headers.referer });
    if (!req.url.startsWith('/v1/')) {
      res.setHeader('content-type', 'text/html');
      const path = new URL(req.url, 'http://fixture').pathname;
      if (path === '/start' || path === '/manual') return res.end(html('<h1>Start page</h1><a target="_blank" href="/result">Open report</a>'));
      if (path === '/result') return res.end(resultPage);
      if (path === '/outside') return res.end(html(`<button onclick="window.open('${outside}/private?token=not-for-model', '_blank')">Open report</button><a href="/result">Local report</a>`));
      if (path === '/redirect-start') return res.end(html('<a target="_blank" href="/redirect">Open report</a><a href="/result">Local report</a>'));
      if (path === '/redirect') { res.writeHead(302, { location: outside + '/redirected?token=not-for-model' }); return res.end(); }
      if (path === '/same-redirect-start') return res.end(html('<a target="_blank" href="/same-redirect">Open report</a>'));
      if (path === '/same-redirect') { res.writeHead(302, { location: '/result' }); return res.end(); }
      if (path === '/post') return res.end(html('<form method="post" action="/submit" target="_blank"><input type="hidden" name="sample" value="preserve-me"><button>Open report</button></form>'));
      if (path === '/submit') return res.end(html('Unexpected form submission'));
      if (path === '/slow-start' || path === '/held-start') return res.end(html(`<a target="_blank" href="/${path === '/slow-start' ? 'slow' : 'held'}">Open report</a>`));
      if (path === '/slow' || path === '/held') { held.set(path, res); return; }
      return res.end(html('Unrelated user tab'));
    }
    let raw = ''; for await (const part of req) raw += part;
    const body = JSON.parse(raw);
    res.setHeader('content-type', 'application/json');
    if (req.url.includes('systemone')) {
      const answers = {};
      for (const [name, head] of Object.entries(body.questions)) {
        let selected;
        if (name === 'web_action') {
          const operation = body.state.page.text.includes('Fixture result revealed') ? 'DONE' : 'CLICK';
          const recovery = body.state.navigationFeedback?.outcomes?.length > 0;
          const label = body.state.page.text.includes('Report page') ? 'Reveal result' : recovery ? 'Local report' : 'Open report';
          if (recovery && body.state.page.text.includes('Local report')) recoveryRequests.push(body);
          selected = Object.entries(head.criteria).find(([, value]) => value.operation === operation && (operation === 'DONE' || value.element?.includes(label)))?.[0];
        } else if (name.startsWith('criterion_')) {
          selected = Object.keys(head.criteria).find(id => String(body.state.untrustedEvidence[id]).includes('Fixture result revealed'));
        } else if (name === 'coverage') {
          selected = Object.values(body.state.untrustedEvidence).some(value => String(value).includes('Fixture result revealed')) ? 'COMPLETE' : 'INCOMPLETE';
        } else if (name === 'task_intent' || name === 'navigation_intent' || name === 'site_scope') {
          // Exercise the existing planner host wiring independently of the fast
          // planner acceptance tests. No request may reach an external model.
          selected = 'UNSUPPORTED' in head.criteria ? 'UNSUPPORTED' : 'OTHER';
        } else selected = Object.keys(head.criteria)[0];
        answers[name] = choice(head.criteria, selected);
      }
      return res.end(JSON.stringify({ model: 'local-fixture', answers }));
    }
    const prompt = body.messages.at(-1).content;
    let content = '{"ok":true}';
    if (prompt.includes('JEVRY_CONVERSATION_PLAN')) content = JSON.stringify({
      intent: 'act', reply: 'I will inspect the fixture.', memory: '',
      goal: 'Click Open report, then Reveal result to read the fixture result.',
      contract: { success: ['The fixture result is revealed.'], constraints: ['Stay on the fixture origin.'], progressOnly: [], allowedOrigins: [base], allowFormSubmission: true },
    });
    else if (prompt.includes('JEVRY_CONVERSATION_ANSWER')) content = JSON.stringify({ reply: 'Fixture run ended; inspect the recorded browser outcome.' });
    res.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }));
  } catch (error) { res.writeHead(500); res.end(JSON.stringify({ error: String(error) })); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let app, stderr = '';
try {
  const env = { ...process.env, JEVRY_TEST_PROFILE: profile };
  delete env.ELECTRON_RUN_AS_NODE; delete env.JEVRY_DEV_URL;
  app = await electron.launch({ args: [resolve('.')], executablePath: electronPath, env, timeout: 30_000 });
  app.process().stderr.on('data', chunk => { stderr += chunk; });
  await app.evaluate(({ session }, allowed) => {
    for (const browserSession of [session.defaultSession, session.fromPartition('persist:jevry-browser')]) {
      browserSession.webRequest.onBeforeRequest((details, callback) => {
        const url = new URL(details.url);
        callback({ cancel: ['http:', 'https:'].includes(url.protocol) && !allowed.includes(url.origin) });
      });
    }
    process.on('uncaughtExceptionMonitor', error => process.stderr.write('JEVRY_UNCAUGHT ' + error.stack + '\n'));
  }, [base, outside]);
  const ui = await app.firstWindow(); await ui.waitForLoadState('domcontentloaded');
  assert((await ui.evaluate(base => window.jevry.connectText({ provider: 'openai', apiKey: 'fixture', baseUrl: base + '/v1' }), base)).ok);
  assert((await ui.evaluate(base => window.jevry.connectJev({ apiKey: 'fixture', baseUrl: base + '/v1/systemone' }), base)).ok);
  assert((await ui.evaluate(() => window.jevry.finishSetup())).ok);
  const state = () => ui.evaluate(() => window.jevry.state());
  const last = async () => { const s = await state(); return s.conversations.find(c => c.id === s.activeConversationId)?.messages.at(-1); };
  const finish = async () => { await expect.poll(() => state().then(s => s.running), { timeout: 20_000 }).toBe(false); return last(); };
  const start = async path => {
    await ui.evaluate(() => window.jevry.newConversation());
    await ui.evaluate(url => window.jevry.navigate(url), base + path);
    const before = await state();
    const id = await app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(w => w.getURL() === url).id, base + path);
    assert((await ui.evaluate(() => window.jevry.sendMessage({ text: 'Click the fixture controls and read the result.', mode: 'act' }))).ok);
    return { tabId: before.activeTabId, tabCount: before.tabs.length, contentsId: id };
  };
  const read = (id, expression) => app.evaluate(({ webContents }, { id, expression }) => webContents.fromId(id).executeJavaScript(expression), { id, expression });
  const assertSameTab = async before => {
    const after = await state();
    assert.equal(after.tabs.length, before.tabCount, 'Task-owned popup must not create a new app tab');
    assert.equal(after.activeTabId, before.tabId);
    assert.equal(await app.evaluate(({ webContents }, id) => webContents.fromId(id).getURL(), before.contentsId), base + '/result');
  };

  for (const path of ['/start', '/same-redirect-start']) {
    const before = await start(path), answer = await finish();
    assert.equal(answer.status, 'complete', JSON.stringify(answer));
    assert(answer.events.some(e => e.type === 'complete'), JSON.stringify(answer.events));
    assert.equal(answer.events.filter(e => e.type === 'action').length, 2, 'Native input must continue on the opened page');
    assert(answer.events.some(e => e.operation === 'NAVIGATION'));
    assert(!answer.events.some(e => ['stopped', 'error'].includes(e.type)));
    assert.equal(await read(before.contentsId, 'document.querySelector("output").textContent'), 'Fixture result revealed');
    await assertSameTab(before);
  }
  assert.equal(requests.find(r => r.path === '/result')?.referrer, base + '/start', 'GET popup must preserve the browser-provided referrer');

  for (const path of ['/outside', '/redirect-start']) {
    const before = await start(path), answer = await finish();
    assert(answer.events.some(e => e.type === 'complete'), JSON.stringify(answer.events));
    assert(answer.events.some(e => e.operation === 'NAVIGATION_REJECTED'));
    assert(!answer.events.some(e => ['blocked', 'stopped', 'error'].includes(e.type)));
    assert.equal(answer.events.filter(e => e.type === 'action').length, 3, 'Recover by choosing a local link, without replaying the rejected route');
    assert.equal(await read(before.contentsId, 'document.querySelector("output").textContent'), 'Fixture result revealed');
    await assertSameTab(before);
  }
  assert.equal(recoveryRequests.length, 2);
  for (const body of recoveryRequests) {
    assert.equal(body.state.navigationFeedback.outcomes.length, 1);
    assert.equal(body.state.navigationFeedback.outcomes[0].origin, outside);
    assert(!JSON.stringify(body).includes('not-for-model'), 'Off-site redirect tokens must not enter model feedback');
    assert(!JSON.stringify(body.state.observations).includes('origin_rejected'), 'Browser feedback is not website evidence');
    const actions = Object.values(body.questions.web_action.criteria);
    if (body.state.page.url.endsWith('/redirect-start')) assert(!actions.some(value => value.href === base + '/redirect'), 'Known rejected GET link must be suppressed for this source page');
    else assert(actions.some(value => value.element?.includes('Open report')), 'Do not guess an observed node for a dynamic popup button');
    assert(actions.some(value => value.element?.includes('Local report')));
  }
  assert.equal(requests.filter(r => r.path === '/redirect').length, 1);

  for (const path of ['/post']) {
    const before = await start(path), answer = await finish();
    assert.equal(answer.status, 'complete', JSON.stringify(answer));
    const blocked = answer.events.find(e => e.type === 'blocked');
    assert(blocked, JSON.stringify(answer.events));
    assert.match(blocked.message, /posted data was not replayed or replaced with a GET/);
    assert.equal(answer.events.filter(e => e.type === 'action').length, 1, 'Do not replay the blocked input');
    assert(!answer.events.some(e => ['stopped', 'error'].includes(e.type)));
    assert.equal((await state()).tabs.length, before.tabCount);
  }
  assert.deepEqual(foreignRequests, [], 'Block cross-origin popups and redirected requests before network dispatch');
  assert.deepEqual(requests.filter(r => r.path === '/submit'), [], 'Never send the denied popup POST, or silently replace its body with GET');

  const stopped = await start('/slow-start');
  await expect.poll(() => held.has('/slow')).toBe(true);
  await ui.evaluate(() => window.jevry.stop());
  const stoppedAnswer = await finish();
  assert.equal(stoppedAnswer.status, 'stopped', JSON.stringify(stoppedAnswer));
  assert.equal(stoppedAnswer.events.filter(e => e.type === 'action').length, 1);
  assert.equal((await state()).tabs.length, stopped.tabCount);
  await expect.poll(() => held.get('/slow').destroyed).toBe(true);
  held.get('/slow').end(resultPage);
  assert.equal(requests.filter(r => r.path === '/slow').length, 1, 'Stop must not retry a popup');
  assert(!stoppedAnswer.events.some(e => e.type === 'complete'));

  // Selecting another user tab must survive the owned navigation finishing.
  const background = await start('/held-start');
  await expect.poll(() => held.has('/held')).toBe(true);
  const userTab = await ui.evaluate(url => window.jevry.newTab(url), base + '/unrelated');
  held.get('/held').end(resultPage);
  const backgroundAnswer = await finish();
  assert(backgroundAnswer.events.some(e => e.type === 'complete'), JSON.stringify(backgroundAnswer));
  assert.equal((await state()).activeTabId, userTab, 'Task completion must not steal the user-selected tab');
  assert.equal((await state()).tabs.length, background.tabCount + 1);
  assert.equal(await read(background.contentsId, 'document.querySelector("output").textContent'), 'Fixture result revealed');

  // Ownership cleanup restores ordinary user-created popup behavior.
  await ui.evaluate(url => window.jevry.navigate(url), base + '/manual');
  const manualBefore = await state();
  await app.evaluate(async ({ webContents }, url) => {
    const wc = webContents.getAllWebContents().find(w => w.getURL() === url);
    const point = await wc.executeJavaScript('(()=>{const r=document.querySelector("a").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()');
    wc.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
    wc.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
  }, base + '/manual');
  await expect.poll(() => state().then(s => s.tabs.length)).toBe(manualBefore.tabs.length + 1);
  const manualAfter = await state();
  assert.notEqual(manualAfter.activeTabId, manualBefore.activeTabId);
  assert.equal(manualAfter.tabs.find(t => t.id === manualBefore.activeTabId).url, base + '/manual');
  assert(!stderr.includes('JEVRY_UNCAUGHT'), stderr);
  console.log('PASS: same-context popup continuation, redirects, scope, POST body protection, Stop, user tab selection and ordinary popups.');
} catch (error) {
  console.error(stderr); throw error;
} finally {
  await app?.close().catch(() => {});
  for (const response of held.values()) response.destroy();
  server.closeAllConnections(); foreign.closeAllConnections();
  await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => foreign.close(resolve))]);
  await rm(profile, { recursive: true, force: true });
}
