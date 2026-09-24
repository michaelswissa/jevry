import { expect, it } from 'vitest';
import { AgentEngine, type BrowserAdapter, type JevRequest, type JevResponse } from './engine';
import { READ_STATE } from './snapshot';
import { PNG } from 'pngjs';

const native = it.runIf(process.env.JEVRY_BROWSER_TEST === '1');
const confirmation = 'Workshop I completed using 20 ordinary resources.';
type Change = 'timer only' | 'removed proof' | 'changed proof' | 'navigation';

function answer(body: JevRequest, selected: Record<string, string>): JevResponse {
  return { model: 'deterministic-native-fixture', answers: Object.fromEntries(Object.entries(selected).map(([head, choice]) => {
    expect(body.questions[head].criteria).toHaveProperty(choice);
    return [head, { choice, confidence: 1, probabilities: Object.fromEntries(Object.keys(body.questions[head].criteria).map(key => [key, key === choice ? 1 : 0])) }];
  })) };
}

async function completionFixture(change: Change) {
  const html = `<!doctype html><html><head><title>Province construction</title></head><body>
    <canvas width="300" height="160" style="display:block;background:#316b82"></canvas>
    <section><button id="build">Build Workshop I</button></section>
    <p id="proof">No workshop has been built.</p><p id="resources">Ordinary resources: 100</p>
    <aside id="timer">World timer: 0</aside>
    <script>window.receipts=[];window.resources=100;
      document.querySelector('#build').onclick=event=>{
        window.resources-=20;window.receipts.push({trusted:event.isTrusted,cost:20});
        document.querySelector('#resources').textContent='Ordinary resources: '+window.resources;
        document.querySelector('#proof').textContent='${confirmation}';
        const board=document.querySelector('canvas'),ctx=board.getContext('2d');
        ctx.fillStyle='#448c40';ctx.fillRect(0,0,board.width,board.height);
      };
    </script></body></html>`;
  const { chromium } = await import('@playwright/test');
  const runtime = await chromium.launch({ headless: true, executablePath: process.env.JEVRY_BROWSER_EXECUTABLE || undefined });
  try {
    const tab = await runtime.newPage({ viewport: { width: 900, height: 650 } });
    // The page and same-origin SPA navigation are entirely local fixtures.
    await tab.route('http://game-fixture.test/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
    await tab.goto('http://game-fixture.test/province');
    const session = await tab.context().newCDPSession(tab);
    const { frameTree } = await session.send('Page.getFrameTree');
    const { executionContextId } = await session.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'jevry-game-completion-test' });
    let timerUpdates = 0;
    const tick = async () => {
      const revision = ++timerUpdates;
      await tab.locator('#timer').evaluate((element, value) => { element.textContent = 'World timer: ' + value; }, revision);
    };
    const browser: BrowserAdapter = {
      evaluate: async <T>(expression: string): Promise<T> => {
        if (expression === READ_STATE) await tick();
        const result = await session.send('Runtime.evaluate', { expression, contextId: executionContextId, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result.value;
      },
      cdp: (method, params) => session.send(method as Parameters<typeof session.send>[0], params),
      url: () => tab.url(), navigate: async url => { await tab.goto(url); },
    };
    let visualCalls = 0, buildChoices = 0, completionChecks = 0, verifyCalls = 0, rejectedChecks = 0;
    let altered = false;
    const result = await new AgentEngine(browser, () => {}, {
      beforeStep: async page => {
        if (!altered) return { handled: false };
        // This hook is reached only if the stale assessment was rejected and
        // the engine resumed with a fresh page. It ends negative fixtures before
        // another order can be proposed; an accepted stale success never gets here.
        rejectedChecks++;
        if (change === 'navigation') expect(page.url).toBe('http://game-fixture.test/other-province');
        else expect(page.text).not.toContain(confirmation);
        return { handled: false, blocked: 'Fixture stopped after rejecting changed completion evidence.' };
      },
      gameInfer: async (_, prompt) => {
        await tick();
        if (++visualCalls > 4) throw new Error('HUD updates caused repeated visual analysis.');
        const context = JSON.parse(prompt.split('UNTRUSTED_CONTEXT: ')[1]) as { page: { page: { text: string } } };
        const built = context.page.page.text.includes(confirmation);
        // Deterministic response exercises the real engine and native inputs;
        // it does not claim that a real vision model recognized the game.
        return JSON.stringify({ strategy: 'Build the requested workshop once, then verify its confirmation.', observation: built ? confirmation : 'The build control is available.', controls: ['pointer'], grid: null, outcome: built ? 'won' : 'ongoing' });
      },
      infer: async (_, body) => {
        await tick();
        if (body.questions.criterion_0) {
          completionChecks++;
          expect(completionChecks).toBe(1);
          const evidence = Object.entries(body.state.untrustedEvidence as Record<string, string>).find(([key, value]) => key.startsWith('line_') && value === 'Observed visible text line: ' + confirmation);
          expect(evidence).toBeDefined();
          const selected = answer(body, { criterion_0: evidence![0], coverage: 'COMPLETE' });
          if (change !== 'timer only') {
            altered = true;
            if (change === 'navigation') await tab.evaluate(() => history.pushState({}, '', '/other-province'));
            else await tab.locator('#proof').evaluate((element, scenario) => {
              if (scenario === 'removed proof') element.remove();
              else element.textContent = 'Workshop II completed using 20 ordinary resources.';
            }, change);
          }
          return selected;
        }
        const text = (body.state.page as { text: string }).text;
        if (text.includes(confirmation)) {
          // A successful visual task review must pause further resource-cost
          // inputs while its independent task contract is being checked.
          expect(Object.keys(body.questions.operation.criteria).sort()).toEqual(['BLOCKED', 'DONE']);
          return answer(body, { operation: 'DONE' });
        }
        const target = Object.entries(body.questions.click_target.criteria).find(([, value]) => (value as { element: string }).element.endsWith('Build Workshop I'));
        expect(target).toBeDefined();
        buildChoices++;
        expect(buildChoices).toBe(1);
        return answer(body, { operation: 'CLICK', click_target: target![0] });
      },
      verifyOutcome: async page => {
        verifyCalls++;
        expect(page.text).toContain('World timer: ' + timerUpdates);
        return page.url === 'http://game-fixture.test/province' && page.text.includes(confirmation);
      },
    }).run({ goal: 'Build one Workshop I with ordinary resources and confirm it completed.', gameMode: 'task', maxSteps: 6,
      contract: { success: ['One Workshop I has completed using ordinary resources.'], constraints: ['Do not repeat the construction order.'], progressOnly: [], allowFormSubmission: false },
      textConfig: { provider: 'openai' }, jevConfig: { apiKey: 'local-fixture-only' },
    });
    expect(completionChecks, result.message).toBe(1);
    expect(buildChoices).toBe(1);
    expect(visualCalls).toBe(2);
    expect(timerUpdates).toBeGreaterThan(7);
    expect(await tab.evaluate('window.receipts')).toEqual([{ trusted: true, cost: 20 }]);
    expect(await tab.locator('#resources').innerText()).toBe('Ordinary resources: 80');
    if (change === 'timer only') {
      expect(result, result.message).toMatchObject({ status: 'complete', verified: true, steps: 1 });
      expect(verifyCalls).toBe(1);
      expect(rejectedChecks).toBe(0);
      expect(result.completionEvidence).toEqual([{ condition: 'One Workshop I has completed using ordinary resources.', evidence: 'Observed visible text line: ' + confirmation }]);
    } else {
      expect(result, result.message).toMatchObject({ status: 'blocked', verified: false, steps: 1 });
      expect(verifyCalls).toBe(0);
      expect(rejectedChecks).toBe(1);
      expect(result.completionEvidence).toBeUndefined();
    }
  } finally { await runtime.close(); }
}

native('completes one native resource-cost build despite HUD changes at every observation and inference', () => completionFixture('timer only'), 15_000);
native.each(['removed proof', 'changed proof', 'navigation'] as const)('rejects a completion assessment after %s without repeating the build', change => completionFixture(change), 15_000);

native.each([false, true])('checks canvas-only construction through a current visual reading (control changed: %s)', async changeControl => {
  const html = `<!doctype html><html><head><title>Province overview</title></head><body>
    <canvas width="320" height="180" style="display:block"></canvas>
    <section><button id="build">Build workshop</button></section><p>Current province overview.</p>
    <script>window.receipts=[];
      const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');
      function draw(built){ctx.fillStyle=built?'#448c40':'#316b82';ctx.fillRect(0,0,320,180);ctx.fillStyle='white';ctx.font='26px sans-serif';ctx.fillText(built?'Workshop I':'Empty building slot',30,95);}
      draw(false);
      document.querySelector('#build').onclick=event=>{window.receipts.push({trusted:event.isTrusted,cost:20});draw(true);};
    </script></body></html>`;
  const observation = 'The canvas shows Workshop I completed in the current province.';
  const { chromium } = await import('@playwright/test');
  const runtime = await chromium.launch({ headless: true, executablePath: process.env.JEVRY_BROWSER_EXECUTABLE || undefined });
  try {
    const tab = await runtime.newPage({ viewport: { width: 900, height: 650 } });
    await tab.setContent(html);
    const session = await tab.context().newCDPSession(tab);
    const { frameTree } = await session.send('Page.getFrameTree');
    const { executionContextId } = await session.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'jevry-visual-completion-test' });
    const browser: BrowserAdapter = {
      evaluate: async <T>(expression: string): Promise<T> => {
        const result = await session.send('Runtime.evaluate', { expression, contextId: executionContextId, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result.value;
      },
      cdp: (method, params) => session.send(method as Parameters<typeof session.send>[0], params),
      url: () => tab.url(), navigate: async url => { await tab.goto(url); },
    };
    let visualCalls = 0, completionChecks = 0, buildChoices = 0, rejectedChecks = 0, changed = false;
    const result = await new AgentEngine(browser, () => {}, {
      beforeStep: async page => {
        if (!changed) return { handled: false };
        rejectedChecks++;
        expect(page.actions.some(action => action.label === 'Inspect another province')).toBe(true);
        return { handled: false, blocked: 'Fixture stopped after the prior visual reading was invalidated.' };
      },
      gameInfer: async (_, prompt, image) => {
        visualCalls++;
        const context = JSON.parse(prompt.split('UNTRUSTED_CONTEXT: ')[1]) as {
          page: { page: { text: string } }; viewport: { width: number; height: number };
          surfaces: Array<{ rect: { x: number; y: number; width: number; height: number } }>;
        };
        expect(context.page.page.text).not.toContain('Workshop I');
        const screenshot = PNG.sync.read(Buffer.from(image.data, 'base64'));
        const rect = context.surfaces[0].rect;
        const x = Math.floor((rect.x + 10) * screenshot.width / context.viewport.width);
        const y = Math.floor((rect.y + 10) * screenshot.height / context.viewport.height);
        const rgb = [...screenshot.data.subarray((y * screenshot.width + x) * 4, (y * screenshot.width + x) * 4 + 3)];
        expect([[49, 107, 130], [68, 140, 64]]).toContainEqual(rgb);
        const built = rgb[0] === 68;
        // Deterministic fixture decoder reads the actual screenshot's known
        // scene color; this does not claim real icon or text recognition.
        return JSON.stringify({ strategy: 'Build once, then check the visible building.', observation: built ? observation : 'The canvas shows an empty building slot.', controls: ['pointer'], grid: null, outcome: built ? 'won' : 'ongoing' });
      },
      infer: async (_, body) => {
        if (body.questions.criterion_0) {
          completionChecks++;
          const evidence = body.state.untrustedEvidence as Record<string, string>;
          expect(evidence.visual_observation).toBe('Current game screenshot reading by the visual model (not independently verified): ' + observation);
          expect(Object.entries(evidence).filter(([key]) => key.startsWith('line_')).every(([, value]) => !value.includes('Workshop I'))).toBe(true);
          const selected = answer(body, { criterion_0: 'visual_observation', coverage: 'COMPLETE' });
          if (changeControl) {
            changed = true;
            await tab.locator('#build').evaluate(element => { element.textContent = 'Inspect another province'; });
          }
          return selected;
        }
        expect((body.state.page as { text: string }).text).not.toContain('Workshop I');
        if ((body.state.game as { last_visual_observation?: string }).last_visual_observation === observation) {
          expect(Object.keys(body.questions.operation.criteria).sort()).toEqual(['BLOCKED', 'DONE']);
          return answer(body, { operation: 'DONE' });
        }
        const target = Object.entries(body.questions.click_target.criteria).find(([, value]) => (value as { element: string }).element.endsWith('Build workshop'));
        expect(target).toBeDefined();
        expect(++buildChoices).toBe(1);
        return answer(body, { operation: 'CLICK', click_target: target![0] });
      },
    }).run({ goal: 'Build one Workshop I in the current province.', gameMode: 'task', maxSteps: 6,
      contract: { success: ['Workshop I is visibly completed in the current province.'], constraints: ['Build only once.'], progressOnly: [], allowFormSubmission: false },
      textConfig: { provider: 'openai' }, jevConfig: { apiKey: 'local-fixture-only' },
    });
    expect(visualCalls, result.message).toBe(2);
    expect(completionChecks, result.message).toBe(1);
    expect(await tab.evaluate('window.receipts')).toEqual([{ trusted: true, cost: 20 }]);
    expect(await tab.locator('body').innerText()).not.toContain('Workshop I');
    if (changeControl) {
      expect(result, result.message).toMatchObject({ status: 'blocked', verified: false, steps: 1 });
      expect(rejectedChecks).toBe(1);
      expect(result.completionEvidence).toBeUndefined();
    } else {
      expect(result, result.message).toMatchObject({ status: 'complete', verified: false, steps: 1 });
      expect(result.completionEvidence).toEqual([{ condition: 'Workshop I is visibly completed in the current province.', evidence: 'Current game screenshot reading by the visual model (not independently verified): ' + observation }]);
      expect(rejectedChecks).toBe(0);
    }
  } finally { await runtime.close(); }
}, 15_000);
