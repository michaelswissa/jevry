import { expect, it } from 'vitest';
import { AgentEngine, type BrowserAdapter, type JevRequest, type JevResponse, type PageState } from './engine';
import { READ_STATE } from './snapshot';

const native = it.runIf(process.env.JEVRY_BROWSER_TEST === '1');
const config = {
  goal: 'Win the visible map game. Decline optional offers; do not purchase anything.',
  gameMode: 'win' as const, maxSteps: 8,
  textConfig: { provider: 'openai' as const }, jevConfig: { apiKey: 'local-fixture-only' },
};

function response(body: JevRequest, operation: string, target?: string): JevResponse {
  const choice = (criteria: Record<string, unknown>, selected: string) => {
    expect(criteria).toHaveProperty(selected);
    return { choice: selected, confidence: 1, probabilities: Object.fromEntries(Object.keys(criteria).map(key => [key, key === selected ? 1 : 0])) };
  };
  const answers: JevResponse['answers'] = { operation: choice(body.questions.operation.criteria, operation) };
  if (target) answers[operation.toLowerCase() + '_target'] = choice(body.questions[operation.toLowerCase() + '_target'].criteria, target);
  return { answers, model: 'local-fixture' };
}

const attribute = (text: string) => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
function fixture(owner: 'frame' | 'ancestor', custom = false) {
  const child = `<!doctype html><html><head><title>Map play area</title></head><body style="margin:0">
    <canvas aria-label="Map" width="400" height="240" style="display:block;margin:20px"></canvas>
    <p id="status">Select the left visible region.</p>
    <script>
      window.events=[];window.stage=0;window.purchases=0;
      const board=document.querySelector('canvas'),ctx=board.getContext('2d');
      function draw(){ctx.fillStyle=window.stage<2?'#1673a4':'#a45d16';ctx.fillRect(0,0,400,240);ctx.fillStyle='white';ctx.fillRect(window.stage<2?80:280,100,40,40);}
      function offer(optional=true,semantic=${!custom}){
        const doc=${owner === 'ancestor' ? 'parent.document' : 'document'},dialog=doc.createElement('section');
        dialog.id='fixture-offer';
        if(semantic){dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');}
        dialog.style.cssText='position:fixed;left:${owner === 'ancestor' ? 210 : 150}px;top:${owner === 'ancestor' ? 110 : 85}px;width:210px;min-height:110px;padding:10px;background:white;z-index:20;border:2px solid black';
        ${custom ? "dialog.style.cssText='position:fixed;inset:0;padding:30px;background:white;z-index:20';" : ''}
        dialog.innerHTML='<h2>Extra supplies offer</h2><p>Purchase extra supplies for this game.</p><button>Buy supplies</button>'+(optional?'${custom ? '<div tabindex="0" style="cursor:pointer;display:inline-block;padding:20px">Keep playing without supplies</div>' : '<button>Decline optional offer</button>'}':'');
        dialog.querySelector('button').onclick=e=>{window.purchases++;window.events.push({kind:'purchase',trusted:e.isTrusted});};
        if(optional)dialog.lastElementChild.onclick=e=>{window.events.push({kind:'dismiss',trusted:e.isTrusted});dialog.remove();window.stage=2;draw();document.querySelector('#status').textContent='Select the right visible region.';};
        doc.body.append(dialog);
      }
      window.showOffer=offer;
      board.onclick=e=>{
        const rect=board.getBoundingClientRect(),x=(e.clientX-rect.left)/rect.width;
        const covered=!!document.querySelector('#fixture-offer')||!!parent.document.querySelector('#fixture-offer');
        window.events.push({kind:'map',trusted:e.isTrusted,x,covered});
        if(covered){document.querySelector('#status').textContent='Invalid input behind dialog';return;}
        if(window.stage===0&&x<.5){window.stage=1;offer();}
        else if(window.stage===2&&x>.5){window.stage=3;document.querySelector('#status').textContent='You win!';}
        else document.querySelector('#status').textContent='Wrong map region';
      };
      board.onkeydown=e=>window.events.push({kind:'key',trusted:e.isTrusted});
      draw();
    </script></body></html>`;
  return `<!doctype html><html><head><title>Map game fixture</title></head><body style="margin:0;padding:30px">
    <iframe id="play-area" title="Map play area" style="width:500px;height:350px;border:6px solid #555" srcdoc="${attribute(child)}"></iframe>
  </body></html>`;
}

async function withBrowser(html: string, check: (browser: BrowserAdapter, tab: import('@playwright/test').Page) => Promise<void>) {
  const { chromium } = await import('@playwright/test');
  const runtime = await chromium.launch({ headless: true, executablePath: process.env.JEVRY_BROWSER_EXECUTABLE || undefined });
  try {
    const tab = await runtime.newPage({ viewport: { width: 900, height: 650 } });
    await tab.setContent(html);
    await tab.frameLocator('#play-area').locator('canvas').waitFor();
    const session = await tab.context().newCDPSession(tab);
    const { frameTree } = await session.send('Page.getFrameTree');
    const { executionContextId } = await session.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'jevry-overlay-test' });
    await check({
      evaluate: async <T>(expression: string): Promise<T> => {
        const result = await session.send('Runtime.evaluate', { expression, contextId: executionContextId, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result.value;
      },
      cdp: (method, params) => session.send(method as Parameters<typeof session.send>[0], params),
      url: () => tab.url(), navigate: async url => { await tab.goto(url); },
    }, tab);
  } finally { await runtime.close(); }
}

function analysis(prompt: string) {
  const context = JSON.parse(prompt.split('UNTRUSTED_CONTEXT: ')[1]) as {
    page: { page: { text: string } }; pointTargets: Record<string, unknown>;
  };
  expect(context.page.page.text).not.toContain('Extra supplies offer');
  const right = context.page.page.text.includes('Select the right');
  return JSON.stringify({
    strategy: 'Select the visibly indicated map region, handling optional prompts first.',
    observation: right ? 'The right region is indicated.' : 'The left region is indicated.',
    outcome: 'ongoing', controls: ['pointer'], grid: null,
    points: [{ target: Object.keys(context.pointTargets)[0], x: right ? .75 : .25, y: .5, label: right ? 'Right indicated region' : 'Left indicated region' }],
  });
}

native.each([
  { owner: 'frame' as const, custom: false },
  { owner: 'ancestor' as const, custom: false },
  { owner: 'frame' as const, custom: true },
])('resumes from a fresh map observation after an optional $owner overlay (custom control: $custom)', async ({ owner, custom }) => {
  await withBrowser(fixture(owner, custom), async (browser, tab) => {
    let visualCalls = 0, modalDecisions = 0;
    const result = await new AgentEngine(browser, () => {}, {
      gameInfer: async (_, prompt) => { visualCalls++; return analysis(prompt); },
      infer: async (_, body) => {
        const text = (body.state.page as { text: string }).text;
        if (text.includes('You win!')) return response(body, 'DONE');
        if (text.includes('Extra supplies offer')) {
          modalDecisions++;
          expect(Object.keys(body.questions.operation.criteria).some(key => key === 'POINT' || key.startsWith('KEY_'))).toBe(false);
          const dismiss = Object.entries(body.questions.click_target.criteria).find(([, value]) => (value as { element: string }).element.endsWith(custom ? 'Keep playing without supplies' : 'Decline optional offer'));
          expect(dismiss).toBeDefined();
          return response(body, 'CLICK', dismiss![0]);
        }
        const point = Object.entries(body.questions.point_target.criteria).find(([, value]) => (value as { position: string }).position === (text.includes('Select the right') ? 'Right indicated region' : 'Left indicated region'));
        expect(point).toBeDefined();
        return response(body, 'POINT', point![0]);
      },
      verifyOutcome: async state => state.text.includes('You win!'),
    }).run(config);
    expect(result, result.message).toMatchObject({ status: 'complete', verified: true, steps: 3 });
    expect(result.actions?.map(action => action.kind)).toEqual(['point', 'click', 'point']);
    expect(modalDecisions).toBe(1);
    expect(visualCalls).toBe(2);
    const state = await tab.frameLocator('#play-area').locator('canvas').evaluate(e => {
      const win = e.ownerDocument.defaultView as Window & { events: unknown[]; purchases: number };
      return { events: win.events, purchases: win.purchases };
    });
    expect(state).toEqual({ purchases: 0, events: [
      { kind: 'map', trusted: true, x: .25, covered: false },
      { kind: 'dismiss', trusted: true },
      { kind: 'map', trusted: true, x: .75, covered: false },
    ] });
  });
}, 15_000);

native.each(['BLOCKED', 'CLICK'])('does not accept a purchase dialog or offer covered iframe input when the actor chooses %s', async operation => {
  await withBrowser(fixture('ancestor'), async (browser, tab) => {
    await tab.frameLocator('#play-area').locator('canvas').evaluate(e => (e.ownerDocument.defaultView as Window & { showOffer: (optional: boolean) => void }).showOffer(false));
    const snapshot = await browser.evaluate<PageState>(READ_STATE);
    expect(snapshot.game_overlay).toBe(true);
    expect(snapshot.actions.filter(action => ['key', 'point'].includes(action.kind))).toEqual([]);
    expect(snapshot.actions.filter(action => action.kind === 'click').map(action => action.label)).toEqual(['Buy supplies']);
    let decisions = 0;
    const result = await new AgentEngine(browser, () => {}, {
      gameInfer: async () => { throw new Error('A dialog must be handled before board analysis.'); },
      infer: async (_, body) => {
        decisions++;
        expect(Object.keys(body.questions.operation.criteria).some(key => key === 'POINT' || key.startsWith('KEY_'))).toBe(false);
        expect(Object.values(body.questions.click_target.criteria)).toHaveLength(1);
        return response(body, operation, operation === 'CLICK' ? Object.keys(body.questions.click_target.criteria)[0] : undefined);
      },
    }).run(config);
    expect(result).toMatchObject({ status: 'blocked', steps: 0 });
    expect(decisions).toBe(1);
    expect(await tab.frameLocator('#play-area').locator('canvas').evaluate(e => (e.ownerDocument.defaultView as Window & { events: unknown[] }).events)).toEqual([]);
    expect(await tab.locator('#fixture-offer').count()).toBe(1);
  });
}, 15_000);

native('refuses a stale map coordinate covered after selection and refreshes before resuming', async () => {
  await withBrowser(fixture('frame'), async (browser, tab) => {
    let injected = false, modalDecisions = 0;
    const nativePresses: Record<string, unknown>[] = [];
    const originalCdp = browser.cdp;
    browser.cdp = async (method, params) => {
      if (method === 'Input.dispatchMouseEvent' && params?.type === 'mousePressed') nativePresses.push(params);
      return originalCdp(method, params);
    };
    const result = await new AgentEngine(browser, () => {}, {
      gameInfer: async (_, prompt) => analysis(prompt),
      infer: async (_, body) => {
        const text = (body.state.page as { text: string }).text;
        if (text.includes('You win!')) return response(body, 'DONE');
        const dismiss = Object.entries(body.questions.click_target?.criteria || {}).find(([, value]) => (value as { element: string }).element.endsWith('Decline optional offer'));
        if (dismiss) {
          modalDecisions++;
          expect(nativePresses).toHaveLength(0);
          return response(body, 'CLICK', dismiss[0]);
        }
        const point = Object.keys(body.questions.point_target.criteria)[0];
        if (!injected) {
          injected = true;
          // The actor has already chosen from the old observation. An
          // overlay now covers that exact map coordinate before native input.
          await tab.frameLocator('#play-area').locator('canvas').evaluate(e => {
            const win = e.ownerDocument.defaultView as Window & { showOffer: (optional: boolean, semantic: boolean) => void };
            win.showOffer(true, true);
            (e.ownerDocument.querySelector('#fixture-offer') as HTMLElement).style.left = '70px';
          });
        }
        return response(body, 'POINT', point);
      }, verifyOutcome: async state => state.text.includes('You win!'),
    }).run(config);
    expect(result, result.message).toMatchObject({ status: 'complete', verified: true, steps: 2 });
    expect(modalDecisions).toBe(1);
    expect(nativePresses).toHaveLength(2);
    expect(await tab.frameLocator('#play-area').locator('canvas').evaluate(e => (e.ownerDocument.defaultView as Window & { events: unknown[] }).events)).toEqual([
      { kind: 'dismiss', trusted: true }, { kind: 'map', trusted: true, x: .75, covered: false },
    ]);
  });
}, 15_000);

native('keeps native game keys available when a dialog contains the game instead of covering it', async () => {
  const html = fixture('frame').replace('<iframe ', '<dialog open style="margin:0;padding:0;border:0"><iframe ').replace('</iframe>', '</iframe></dialog>');
  await withBrowser(html, async (browser, tab) => {
    await tab.frameLocator('#play-area').locator('canvas').evaluate(e => {
      (e as HTMLElement).onkeydown = event => {
        const win = e.ownerDocument.defaultView as Window & { events: unknown[] };
        win.events.push({ kind: 'key', trusted: event.isTrusted, key: event.key });
        e.ownerDocument.querySelector('#status')!.textContent = 'You win!';
      };
    });
    const before = await browser.evaluate<PageState>(READ_STATE);
    expect(before.game_overlay).not.toBe(true);
    expect(before.actions.some(action => action.kind === 'key' && action.key === 'ArrowLeft')).toBe(true);
    const result = await new AgentEngine(browser, () => {}, {
      gameInfer: async () => JSON.stringify({ strategy: 'Use the offered arrow control.', observation: 'The game is inside its own dialog.', outcome: 'ongoing', controls: ['arrows'], grid: null }),
      infer: async (_, body) => response(body, (body.state.page as { text: string }).text.includes('You win!') ? 'DONE' : 'KEY_LEFT'),
      verifyOutcome: async state => state.text.includes('You win!'),
    }).run(config);
    expect(result, result.message).toMatchObject({ status: 'complete', verified: true, steps: 1 });
    expect(await tab.frameLocator('#play-area').locator('canvas').evaluate(e => (e.ownerDocument.defaultView as Window & { events: unknown[] }).events)).toEqual([
      { kind: 'key', trusted: true, key: 'ArrowLeft' },
    ]);
    expect(await tab.frameLocator('#play-area').locator('canvas').getAttribute('tabindex')).toBeNull();
  });
}, 15_000);

native('dispatches a grounded map point after one analysis while using fresh animated HUD state', async () => {
  await withBrowser(fixture('frame'), async (browser, tab) => {
    const canvas = tab.frameLocator('#play-area').locator('canvas');
    await canvas.evaluate(e => {
      e.ownerDocument.body.insertAdjacentHTML('beforeend', '<aside id="timer">Map update 0</aside>');
      (e as HTMLElement).onclick = event => {
        const rect = e.getBoundingClientRect();
        const win = e.ownerDocument.defaultView as Window & { events: unknown[] };
        const x = (event.clientX - rect.left) / rect.width;
        win.events.push({ kind: 'map', trusted: event.isTrusted, x });
        e.ownerDocument.querySelector('#status')!.textContent = x === .25 ? 'You win!' : 'Wrong map region';
      };
    });
    let visualCalls = 0, moveDecisions = 0;
    const result = await new AgentEngine(browser, () => {}, {
      gameInfer: async (_, prompt) => {
        visualCalls++;
        // Bound a broken reanalysis loop so this regression fails promptly.
        if (visualCalls > 3) throw new Error('Animation caused repeated analysis before the first input.');
        await canvas.evaluate((e, revision) => {
          // Animate an unrelated map area while the indicated left region and
          // surface geometry remain unchanged throughout the awaited analysis.
          const ctx = (e as HTMLCanvasElement).getContext('2d')!;
          ctx.fillStyle = revision % 2 ? '#f0a040' : '#40f0a0';
          ctx.fillRect(250, 170, 120, 60);
          e.ownerDocument.querySelector('#timer')!.textContent = 'Map update ' + revision;
          if (!e.ownerDocument.querySelector('#details')) {
            e.ownerDocument.body.insertAdjacentHTML('beforeend', '<button id="details" style="position:fixed;right:10px;top:300px">Updated map details</button>');
          }
        }, visualCalls);
        return analysis(prompt);
      },
      infer: async (_, body) => {
        const text = (body.state.page as { text: string }).text;
        if (text.includes('You win!')) return response(body, 'DONE');
        moveDecisions++;
        expect(visualCalls).toBe(1);
        expect(text).toContain('Map update 1');
        expect(text).not.toContain('Map update 0');
        expect(Object.values(body.questions.click_target.criteria).some(value => (value as { element: string }).element.endsWith('Updated map details'))).toBe(true);
        const point = Object.entries(body.questions.point_target.criteria).find(([, value]) => (value as { position: string }).position === 'Left indicated region');
        expect(point).toBeDefined();
        return response(body, 'POINT', point![0]);
      },
      verifyOutcome: async state => state.text.includes('You win!'),
    }).run(config);
    expect(result, result.message).toMatchObject({ status: 'complete', verified: true, steps: 1 });
    expect(visualCalls).toBe(1);
    expect(moveDecisions).toBe(1);
    expect(await canvas.evaluate(e => (e.ownerDocument.defaultView as Window & { events: unknown[] }).events)).toEqual([
      { kind: 'map', trusted: true, x: .25 },
    ]);
  });
}, 15_000);
