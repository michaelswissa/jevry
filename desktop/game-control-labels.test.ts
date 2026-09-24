import { expect, it } from 'vitest';
import { AgentEngine, type BrowserAdapter, type JevRequest, type JevResponse } from './engine';

const native = it.runIf(process.env.JEVRY_BROWSER_TEST === '1');
const attribute = (text: string) => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;');

function answer(body: JevRequest, selected: Record<string, string>): JevResponse {
  return { model: 'local-fixture', answers: Object.fromEntries(Object.entries(selected).map(([head, choice]) => {
    expect(body.questions[head].criteria).toHaveProperty(choice);
    return [head, { choice, confidence: 1, probabilities: Object.fromEntries(Object.keys(body.questions[head].criteria).map(key => [key, key === choice ? 1 : 0])) }];
  })) };
}

native('labels only observed iframe icon controls and clicks the construction control with trusted native input', async () => {
  const child = `<!doctype html><html><head><title>Province panel</title></head><body style="margin:0;padding:20px">
    <canvas aria-label="Region map" width="400" height="180" style="display:block;background:#316b82"></canvas>
    <section style="width:210px;margin-top:20px"><h2>Province actions</h2>
      <div style="display:flex;gap:20px">
        <button style="width:48px;height:48px;padding:4px"><svg aria-hidden="true" viewBox="0 0 40 40"><path d="M28 7 L12 20 L28 33" fill="none" stroke="black" stroke-width="5"/></svg></button>
        <button style="width:48px;height:48px;padding:4px"><svg aria-hidden="true" viewBox="0 0 40 40"><path d="M6 9 L12 3 L29 20 L23 26 Z M18 17 L23 22 L10 35 L5 30 Z" fill="black"/></svg></button>
        <button style="width:48px;height:48px;padding:4px"><svg aria-hidden="true" viewBox="0 0 40 40"><path d="M12 7 L28 20 L12 33" fill="none" stroke="black" stroke-width="5"/></svg></button>
      </div>
    </section>
    <p id="result">Choose an action.</p>
    <script>window.receipts=[];
      document.querySelectorAll('button').forEach((button,index)=>button.onclick=event=>{
        window.receipts.push({index,trusted:event.isTrusted});
        document.querySelector('#result').textContent=index===1?'Construction options ready: Farm, Workshop.':'Selected a different province.';
      });
    </script></body></html>`;
  const { chromium } = await import('@playwright/test');
  const runtime = await chromium.launch({ headless: true, executablePath: process.env.JEVRY_BROWSER_EXECUTABLE || undefined });
  try {
    const tab = await runtime.newPage({ viewport: { width: 900, height: 650 } });
    await tab.setContent(`<!doctype html><html><body style="margin:0"><iframe id="game" title="Province panel" style="position:absolute;left:73px;top:47px;border:7px solid;width:560px;height:420px" srcdoc="${attribute(child)}"></iframe></body></html>`);
    const buttons = tab.frameLocator('#game').locator('button');
    await buttons.first().waitFor();
    const frameRect = (await tab.locator('#game').boundingBox())!;
    const localRects = await buttons.evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }));
    const expectedRects = localRects.map(rect => ({ x: frameRect.x + 7 + rect.x, y: frameRect.y + 7 + rect.y, w: rect.width, h: rect.height }));
    expect(expectedRects[0].x).toBe(100);
    const session = await tab.context().newCDPSession(tab);
    const { frameTree } = await session.send('Page.getFrameTree');
    const { executionContextId } = await session.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'jevry-control-label-test' });
    const browser: BrowserAdapter = {
      evaluate: async <T>(expression: string): Promise<T> => {
        const result = await session.send('Runtime.evaluate', { expression, contextId: executionContextId, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result.value;
      },
      cdp: (method, params) => session.send(method as Parameters<typeof session.send>[0], params),
      url: () => tab.url(), navigate: async url => { await tab.goto(url); },
    };
    let visualCalls = 0, clickDecisions = 0;
    let offeredTargets: string[] = [];
    const result = await new AgentEngine(browser, () => {}, {
      gameInfer: async (_, prompt) => {
        visualCalls++;
        const context = JSON.parse(prompt.split('UNTRUSTED_CONTEXT: ')[1]) as {
          domControls: Array<{ target: string; label: string; rect: { x: number; y: number; w: number; h: number } }>;
          page: { page: { text: string } };
        };
        const controls = [...context.domControls].sort((left, right) => left.rect.x - right.rect.x);
        expect(controls).toHaveLength(3);
        expect(controls.map(control => control.rect)).toEqual(expectedRects);
        expect(controls.every(control => !/previous|construction|next/i.test(control.label))).toBe(true);
        offeredTargets = controls.map(control => control.target);
        // This is a deterministic visual-response fixture, not a claim that a
        // real vision model recognized these icons. Only offered targets are
        // annotated, and their independently measured iframe geometry is tested.
        return JSON.stringify({ strategy: 'Open the construction options through the visible hammer control.', observation: 'Three icon controls are visible below the map.', controls: ['pointer'], grid: null, outcome: 'ongoing',
          controlLabels: controls.map((control, index) => ({ target: control.target, label: ['Previous province', 'Open construction panel', 'Next province'][index] })),
        });
      },
      infer: async (_, body) => {
        if (body.questions.criterion_0) {
          const evidence = Object.entries(body.state.untrustedEvidence as Record<string, string>).find(([key, value]) => key.startsWith('evidence_') && value.includes('Construction options ready: Farm, Workshop.'));
          expect(evidence).toBeDefined();
          return answer(body, { criterion_0: evidence![0], coverage: 'COMPLETE' });
        }
        if ((body.state.page as { text: string }).text.includes('Construction options ready: Farm, Workshop.')) return answer(body, { operation: 'DONE' });
        clickDecisions++;
        expect(Object.keys(body.questions.click_target.criteria).sort()).toEqual([...offeredTargets].sort());
        const controls = Object.entries(body.questions.click_target.criteria) as Array<[string, { element: string; visual_label?: string }]>;
        const construction = controls.find(([, control]) => control.visual_label === 'Open construction panel');
        expect(construction).toBeDefined();
        expect(construction![1].element).not.toContain('Open construction panel');
        return answer(body, { operation: 'CLICK', click_target: construction![0] });
      },
      verifyOutcome: async page => page.text.includes('Construction options ready: Farm, Workshop.'),
    }).run({ goal: 'Open the construction options for the current province.', gameMode: 'task', maxSteps: 3,
      contract: { success: ['The current province construction options are visibly open.'], constraints: ['Do not purchase anything.'], progressOnly: [], allowFormSubmission: false },
      textConfig: { provider: 'openai' }, jevConfig: { apiKey: 'local-fixture-only' },
    });
    expect(result, result.message).toMatchObject({ status: 'complete', verified: true, steps: 1 });
    expect(visualCalls).toBe(1);
    expect(clickDecisions).toBe(1);
    expect(await buttons.first().evaluate(e => (e.ownerDocument.defaultView as Window & { receipts: unknown[] }).receipts)).toEqual([{ index: 1, trusted: true }]);
    expect(await tab.frameLocator('#game').locator('#result').innerText()).toBe('Construction options ready: Farm, Workshop.');
  } finally { await runtime.close(); }
}, 15_000);

native('uses fresh icon annotations through a fullscreen game panel and information overlay with no exposed canvas', async () => {
  const child = `<!doctype html><html><head><title>Construction panel</title></head><body style="margin:0">
    <canvas width="400" height="240" style="margin:30px;background:#316b82"></canvas>
    <section id="panel" style="position:fixed;inset:0;padding:25px;background:#eee;z-index:10">
      <h1>Workshop construction</h1><p id="status">Inspect the building details before starting.</p>
      <div id="controls" style="display:flex;gap:30px">
        <button id="info" style="width:48px;height:48px"><svg aria-hidden="true" viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" fill="none" stroke="black" stroke-width="3"/><path d="M20 17 V30 M20 10 V12" stroke="black" stroke-width="4"/></svg></button>
        <button id="build" style="width:48px;height:48px"><svg aria-hidden="true" viewBox="0 0 40 40"><path d="M6 9 L12 3 L29 20 L23 26 Z M18 17 L23 22 L10 35 L5 30 Z" fill="black"/></svg></button>
      </div>
    </section>
    <section id="details" hidden style="position:fixed;inset:0;padding:25px;background:#b6d6de;z-index:20">
      <h2>Building details opened</h2><p>The workshop requires 20 ordinary resources.</p>
      <button id="close" style="position:absolute;right:20px;top:20px;width:48px;height:48px"><svg aria-hidden="true" viewBox="0 0 40 40"><path d="M8 8 L32 32 M32 8 L8 32" stroke="black" stroke-width="4"/></svg></button>
    </section>
    <script>window.receipts=[];
      document.querySelector('#info').onclick=event=>{window.receipts.push({control:'info',trusted:event.isTrusted});document.querySelector('#details').hidden=false;};
      document.querySelector('#close').onclick=event=>{window.receipts.push({control:'close',trusted:event.isTrusted});document.querySelector('#details').hidden=true;document.querySelector('#status').textContent='Details reviewed; ready to construct.';};
      document.querySelector('#build').onclick=event=>{window.receipts.push({control:'build',trusted:event.isTrusted});document.querySelector('#status').textContent='Workshop construction queued using 20 ordinary resources. Details reviewed.';document.querySelector('#controls').remove();};
      document.querySelector('canvas').onclick=event=>window.receipts.push({control:'covered-map',trusted:event.isTrusted});
    </script></body></html>`;
  const { chromium } = await import('@playwright/test');
  const runtime = await chromium.launch({ headless: true, executablePath: process.env.JEVRY_BROWSER_EXECUTABLE || undefined });
  try {
    const tab = await runtime.newPage({ viewport: { width: 900, height: 650 } });
    await tab.setContent(`<!doctype html><html><body><iframe id="game" title="Construction panel" style="position:absolute;left:61px;top:43px;border:5px solid;width:580px;height:420px" srcdoc="${attribute(child)}"></iframe></body></html>`);
    await tab.frameLocator('#game').locator('#info').waitFor();
    const session = await tab.context().newCDPSession(tab);
    const { frameTree } = await session.send('Page.getFrameTree');
    const { executionContextId } = await session.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'jevry-covered-game-panel-test' });
    const browser: BrowserAdapter = {
      evaluate: async <T>(expression: string): Promise<T> => {
        const result = await session.send('Runtime.evaluate', { expression, contextId: executionContextId, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result.value;
      },
      cdp: (method, params) => session.send(method as Parameters<typeof session.send>[0], params),
      url: () => tab.url(), navigate: async url => { await tab.goto(url); },
    };
    const analyzedScenes: string[] = [], selectedLabels: string[] = [];
    let preliminaryChoices = 0;
    const result = await new AgentEngine(browser, () => {}, {
      gameInfer: async (_, prompt) => {
        const context = JSON.parse(prompt.split('UNTRUSTED_CONTEXT: ')[1]) as {
          surfaces: unknown[]; pointTargets: Record<string, unknown>;
          domControls: Array<{ target: string; rect: { x: number; y: number; w: number; h: number } }>;
          page: { page: { text: string } };
        };
        expect(context.surfaces).toEqual([]);
        expect(context.pointTargets).toEqual({});
        const detailView = context.page.page.text.includes('Building details opened');
        const reviewed = context.page.page.text.includes('Details reviewed; ready to construct.');
        analyzedScenes.push(detailView ? 'details' : reviewed ? 'reviewed panel' : 'initial panel');
        const controls = [...context.domControls].sort((left, right) => left.rect.x - right.rect.x);
        expect(controls).toHaveLength(detailView ? 1 : 2);
        const selectors = detailView ? ['#close'] : ['#info', '#build'];
        for (const [index, selector] of selectors.entries()) {
          const observed = (await tab.frameLocator('#game').locator(selector).boundingBox())!;
          expect(controls[index].rect).toEqual({ x: observed.x, y: observed.y, w: observed.width, h: observed.height });
        }
        // Model responses are stubbed; the test exercises the annotation path
        // and native input, not the quality of real screenshot recognition.
        return JSON.stringify({ strategy: 'Inspect the details, close that panel, then queue ordinary construction.', observation: detailView ? 'Building information panel is visible.' : 'Construction controls are visible.', controls: ['pointer'], grid: null, outcome: 'ongoing',
          controlLabels: controls.map((control, index) => ({ target: control.target, label: detailView ? 'Close building information' : ['Inspect building details', 'Queue workshop construction'][index] })),
        });
      },
      infer: async (_, body) => {
        if (body.questions.criterion_0) {
          const evidence = Object.entries(body.state.untrustedEvidence as Record<string, string>).find(([key, value]) => key.startsWith('evidence_') && value.includes('Workshop construction queued using 20 ordinary resources. Details reviewed.'));
          expect(evidence).toBeDefined();
          return answer(body, { criterion_0: evidence![0], coverage: 'COMPLETE' });
        }
        const text = (body.state.page as { text: string }).text;
        expect(Object.keys(body.questions.operation.criteria).some(key => key === 'POINT' || key.startsWith('KEY_'))).toBe(false);
        if (text.includes('Workshop construction queued')) return answer(body, { operation: 'DONE' });
        const wanted = text.includes('Building details opened') ? 'Close building information' : text.includes('Details reviewed; ready to construct.') ? 'Queue workshop construction' : 'Inspect building details';
        const controls = Object.entries(body.questions.click_target.criteria) as Array<[string, { element: string; visual_label?: string }]>;
        if (controls.every(([, control]) => !control.visual_label)) {
          preliminaryChoices++;
          expect(await tab.frameLocator('#game').locator('canvas').evaluate(e => (e.ownerDocument.defaultView as Window & { receipts: unknown[] }).receipts)).toHaveLength(selectedLabels.length);
          // The initial raw choice is deliberately the other construction
          // icon. It must trigger clarification, never dispatch that click.
          const rawTarget = controls.at(-1)!;
          expect(rawTarget[1].element).toMatch(/\]\s+(?:Unlabeled button\b|button$)/i);
          return answer(body, { operation: 'CLICK', click_target: rawTarget[0] });
        }
        const target = controls.find(([, control]) => control.visual_label === wanted);
        expect(target).toBeDefined();
        if (wanted === 'Close building information') expect(controls).toHaveLength(1);
        selectedLabels.push(wanted);
        return answer(body, { operation: 'CLICK', click_target: target![0] });
      },
      verifyOutcome: async page => page.text.includes('Workshop construction queued using 20 ordinary resources. Details reviewed.'),
    }).run({ goal: 'Inspect the workshop details, then queue its construction using ordinary resources.', gameMode: 'task', maxSteps: 6,
      contract: { success: ['Workshop construction is queued after inspecting its details.'], constraints: ['Use ordinary resources only.'], progressOnly: [], allowFormSubmission: false },
      textConfig: { provider: 'openai' }, jevConfig: { apiKey: 'local-fixture-only' },
    });
    expect(result, result.message).toMatchObject({ status: 'complete', verified: true, steps: 3 });
    expect(analyzedScenes).toEqual(['initial panel', 'details', 'reviewed panel']);
    expect(preliminaryChoices).toBe(3);
    expect(selectedLabels).toEqual(['Inspect building details', 'Close building information', 'Queue workshop construction']);
    expect(await tab.frameLocator('#game').locator('canvas').evaluate(e => (e.ownerDocument.defaultView as Window & { receipts: unknown[] }).receipts)).toEqual([
      { control: 'info', trusted: true }, { control: 'close', trusted: true }, { control: 'build', trusted: true },
    ]);
    expect(await tab.frameLocator('#game').locator('#details').isVisible()).toBe(false);
  } finally { await runtime.close(); }
}, 15_000);

native('dismisses a named optional offer without visual analysis despite an available unlabeled background icon', async () => {
  const child = `<!doctype html><html><body style="margin:0">
    <canvas width="400" height="240" style="background:#316b82"></canvas>
    <button id="background" style="position:absolute;left:545px;top:30px;width:48px;height:48px"><svg aria-hidden="true" viewBox="0 0 40 40"><path d="M10 10 L30 30 M30 10 L10 30" stroke="black" stroke-width="3"/></svg></button>
    <section id="offer" style="position:fixed;left:0;top:0;width:500px;height:300px;background:white;z-index:10">
      <h1>Optional supplies offer</h1><button id="decline">Decline offer</button>
    </section>
    <script>window.receipts=[];
      document.querySelector('#decline').onclick=event=>{window.receipts.push({control:'decline',trusted:event.isTrusted});document.querySelector('#offer').remove();};
      document.querySelector('#background').onclick=event=>window.receipts.push({control:'background',trusted:event.isTrusted});
    </script></body></html>`;
  const { chromium } = await import('@playwright/test');
  const runtime = await chromium.launch({ headless: true, executablePath: process.env.JEVRY_BROWSER_EXECUTABLE || undefined });
  try {
    const tab = await runtime.newPage({ viewport: { width: 900, height: 650 } });
    await tab.setContent(`<!doctype html><html><body><iframe id="game" title="Game offers" style="width:650px;height:400px;border:4px solid" srcdoc="${attribute(child)}"></iframe></body></html>`);
    await tab.frameLocator('#game').locator('#decline').waitFor();
    const session = await tab.context().newCDPSession(tab);
    const { frameTree } = await session.send('Page.getFrameTree');
    const { executionContextId } = await session.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'jevry-named-dismissal-test' });
    const browser: BrowserAdapter = {
      evaluate: async <T>(expression: string): Promise<T> => {
        const result = await session.send('Runtime.evaluate', { expression, contextId: executionContextId, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result.value;
      },
      cdp: (method, params) => session.send(method as Parameters<typeof session.send>[0], params),
      url: () => tab.url(), navigate: async url => { await tab.goto(url); },
    };
    let visualCalls = 0;
    const result = await new AgentEngine(browser, () => {}, {
      gameInfer: async () => { visualCalls++; throw new Error('A named dismissal does not need icon interpretation.'); },
      infer: async (_, body) => {
        const controls = Object.entries(body.questions.click_target.criteria) as Array<[string, { element: string; visual_label?: string }]>;
        expect(controls).toHaveLength(2);
        expect(controls.some(([, control]) => /\]\s+(?:Unlabeled button\b|button$)/i.test(control.element))).toBe(true);
        expect(controls.every(([, control]) => !control.visual_label)).toBe(true);
        expect(body.questions.operation.criteria.POINT).toBeUndefined();
        const decline = controls.find(([, control]) => control.element.endsWith('Decline offer'));
        expect(decline).toBeDefined();
        return answer(body, { operation: 'CLICK', click_target: decline![0] });
      },
    }).run({ goal: 'Dismiss the optional offer and continue the current game.', gameMode: 'task', maxSteps: 1,
      textConfig: { provider: 'openai' }, jevConfig: { apiKey: 'local-fixture-only' },
    });
    // The one-input budget deliberately ends this fixture without claiming the
    // larger game objective complete; the dismissal itself is checked in DOM.
    expect(result, result.message).toMatchObject({ status: 'blocked', steps: 1, verified: false });
    expect(result.message).toContain('1-action budget');
    expect(visualCalls).toBe(0);
    expect(await tab.frameLocator('#game').locator('#offer').count()).toBe(0);
    expect(await tab.frameLocator('#game').locator('canvas').evaluate(e => (e.ownerDocument.defaultView as Window & { receipts: unknown[] }).receipts)).toEqual([
      { control: 'decline', trusted: true },
    ]);
  } finally { await runtime.close(); }
}, 15_000);
