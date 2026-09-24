// Real Electron integration, isolated disposable profile, local deterministic model stubs.
// No external model calls or user credentials. This is correctness evidence, not a model benchmark.
import { _electron as electron, expect } from "@playwright/test";
import electronPath from "electron";
import { createServer } from "node:http";
import { mkdtemp, rm, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const root = resolve(".");
const profile = await mkdtemp(join(tmpdir(), "jevry-smoke-"));
const fixture = `<!doctype html><html><head><title>Stay search fixture</title></head><body style="font:18px system-ui;padding:40px"><h1>Find a stay</h1><form><label for="destination">Destination</label><input id="destination" value="Berlin"><label for="guests">Guests</label><select id="guests"><option value="1">1 guest</option><option value="2">2 guests</option></select><button type="submit">Find stays</button></form><p id="results">Awaiting a search</p><script>document.querySelector('form').onsubmit=e=>{e.preventDefault();document.querySelector('#results').textContent='Stays in '+document.querySelector('input').value+' for '+document.querySelector('select').value+' guests'}</script></body></html>`;
let modelSteps = 0;
const selected = [];
let holdInference = false;
let city="London";
const plans=[];
function choice(criteria, selected) {
  return {
    choice: selected,
    confidence: 1,
    probabilities: Object.fromEntries(
      Object.keys(criteria).map((key) => [key, key === selected ? 1 : 0]),
    ),
  };
}
const server = createServer(async (req, res) => {
  if (req.method === "GET") {
    res.setHeader("Content-Type", "text/html");
    res.end(fixture);
    return;
  }
  let raw = "";
  for await (const part of req) raw += part;
  const body = JSON.parse(raw);
  res.setHeader("Content-Type", "application/json");
  if (req.url.includes("chat/completions")) {
    const prompt = body.messages.at(-1).content;
    let content;
    if(prompt.includes('JEVRY_CONVERSATION_PLAN')) {
      const context=JSON.parse(prompt.split('CONVERSATION_JSON: ')[1].split('\nOPEN_TABS_JSON:')[0]);
      const latest=context.messages.at(-1).content;
      plans.push(context);
      const chat=/what|hello|just answer/i.test(latest);
      const research=prompt.includes('explicit mode is research');
      if(latest.includes('Paris')) city='Paris';
      content=JSON.stringify({reply:chat?`The page shows stays in ${city} for 2 guests.`:'I’ll check the stays.',intent:research?'research':chat?'chat':'act',goal:research?'What stays are on the page?':`Find stays in ${city} for 2 guests`,memory:'Two guests'});
    } else if(prompt.includes('JEVRY_CONVERSATION_ANSWER')) content=JSON.stringify({reply:`The page shows stays in ${city} for **2 guests**.`});
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: content || (prompt.includes("Reply with exactly")
                ? '{"ok":true}'
                : prompt.includes("AUTHORITATIVE_SOURCE_IDS")
                  ? JSON.stringify({
                      summary: `${city} stays for two guests are visible [S1].`,
                      findings: [
                        {
                          text: `The search returned stays in ${city} for two guests.`,
                          sourceIds: ["S1"],
                        },
                      ],
                    })
                  : JSON.stringify({text:city})),
            },
            finish_reason: "stop",
          },
        ],
      }),
    );
    return;
  }
  if (req.url.includes("systemone")) {
    // Keep this conversation/provider smoke on the general planner. Dedicated
    // fast-plan tests exercise acceptance; here uncertainty must fall back.
    if(body.questions.task_intent||body.questions.navigation_intent) {
      res.end(JSON.stringify({model:'jev-test',answers:Object.fromEntries(Object.entries(body.questions).map(([name,q])=>[name,choice(q.criteria,'UNSUPPORTED' in q.criteria?'UNSUPPORTED':'OTHER' in q.criteria?'OTHER':'MIXED_UNSUPPORTED' in q.criteria?'MIXED_UNSUPPORTED':Object.keys(q.criteria)[0])]))}));
      return;
    }
    // Connection validation uses its own choice question.
    if (!body.questions.operation && !body.questions.web_action) {
      res.end(
        JSON.stringify({
          model: "jev-test",
          answers: Object.fromEntries(
            Object.entries(body.questions).map(([name, q]) => [
              name,
              choice(q.criteria, Object.keys(q.criteria)[0]),
            ]),
          ),
        }),
      );
      return;
    }
    if (holdInference) {
      req.on("close", () => {});
      return;
    }
    const elements=body.state.elements;
    const destination=elements.find(e=>e.label==='Destination');
    const guests=elements.find(e=>e.label==='Guests');
    const [operation,label]=body.state.page.text.includes(`Stays in ${city} for 2 guests`)?['DONE']:
      destination?.value!==city?['TYPE_TEXT','Destination']:
      guests?.value!=='2 guests'?['SELECT','Guests → 2 guests']:['CLICK','Find stays'];
    modelSteps++;
    selected.push(operation);
    const joint = body.questions.web_action;
    const answers = joint ? {} : {
      operation: choice(body.questions.operation.criteria, operation),
    };
    if (joint) {
      const id = Object.entries(joint.criteria).find(([, value]) => value.operation === operation && (!label || value.element?.includes(label)))?.[0];
      if (!id) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: "Fixture complete action missing" }));
        return;
      }
      answers.web_action = choice(joint.criteria, id);
    } else if (label) {
      const name = operation.toLowerCase() + "_target";
      const criteria = body.questions[name].criteria;
      const id = Object.entries(criteria).find(([, v]) =>
        v.element.includes(label),
      )?.[0];
      if (!id) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: "Fixture target missing" }));
        return;
      }
      answers[name] = choice(criteria, id);
    }
    res.end(JSON.stringify({ model: "jev-test", answers }));
    return;
  }
  res.statusCode = 404;
  res.end("{}");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const env = { ...process.env, JEVRY_TEST_PROFILE: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.JEVRY_DEV_URL;
let app;
try {
  app = await electron.launch({
    args: process.env.JEVRY_PACKAGED_EXECUTABLE ? [] : [root],
    executablePath: process.env.JEVRY_PACKAGED_EXECUTABLE || electronPath,
    env,
    timeout: 30000,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(
    page.getByRole("heading", { name: "Make yourself at home." }),
  ).toBeVisible();
  await page.getByRole("radio", { name: "API key Your own provider" }).click();
  await page
    .getByRole("textbox", { name: "API key", exact: true })
    .fill("fixture-text-key");
  await page
    .locator("summary")
    .filter({ hasText: "Model and endpoint" })
    .click();
  await page
    .getByRole("textbox", { name: "API base URL", exact: true })
    .fill(base + "/v1");
  await page
    .getByRole("button", { name: "Connect text model", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Give your browser reflexes." }),
  ).toBeVisible({ timeout: 15000 });
  await page
    .getByRole("textbox", { name: "TypeSafe API key", exact: true })
    .fill("fixture-jev-key");
  await page.locator("summary").filter({ hasText: "Model settings" }).click();
  await page
    .getByRole("textbox", { name: "Jev endpoint", exact: true })
    .fill(base + "/v1/systemone");
  await page.getByRole("button", { name: "Connect Jev", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "All systems, ready." }),
  ).toBeVisible({ timeout: 15000 });
  const publicState = await page.evaluate(() => window.jevry.state());
  assert(!JSON.stringify(publicState).includes("fixture-text-key"));
  assert(!JSON.stringify(publicState).includes("fixture-jev-key"));
  const encrypted = await readFile(join(profile, "connections.enc"));
  assert(!encrypted.toString().includes("fixture-text-key"));
  await page.getByRole("button", { name: "Enter your browser" }).click();
  await expect(
    page.getByRole("heading", { name: "Room to explore." }),
  ).toBeVisible();
  await mkdir(join(root, "artifacts"), { recursive: true });
  await page.screenshot({ path: join(root, "artifacts/browser.png") });
  await page
    .getByRole("textbox", { name: "Search or enter a URL", exact: true })
    .fill(base + "/fixture");
  await page
    .getByRole("textbox", { name: "Search or enter a URL", exact: true })
    .press("Enter");
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.jevry
          .state()
          .then((s) => s.tabs.find((t) => t.id === s.activeTabId)?.title),
      ),
    )
    .toBe("Stay search fixture");
  const security = await app.evaluate(async ({ webContents }) => {
    const wc = webContents
      .getAllWebContents()
      .find((w) => w.getURL().includes("/fixture"));
    return wc.executeJavaScript(
      "({bridge:typeof window.jevry,node:typeof process})",
    );
  });
  assert.deepEqual(security, { bridge: "undefined", node: "undefined" });
  const send=async(text)=>{
    await page.getByRole('textbox',{name:'Message Jevry'}).fill(text);
    await page.getByRole('button',{name:'Send message',exact:true}).click();
    await expect(page.getByRole('textbox',{name:'Message Jevry'})).toHaveValue('');
    await expect.poll(()=>page.evaluate(()=>window.jevry.state().then(s=>{const m=s.conversations.find(c=>c.id===s.activeConversationId)?.messages.at(-1);if(m?.status==='error')throw new Error(m.error);return m?.status;})),{timeout:20000}).toBe('complete');
  };
  await send('Find stays in London for 2 guests');
  const readResult=()=>app.evaluate(async ({webContents})=>webContents.getAllWebContents().find(w=>w.getURL().includes('/fixture')).executeJavaScript('document.querySelector("#results").textContent'));
  assert.equal(await readResult(),'Stays in London for 2 guests');
  assert.deepEqual(selected,['TYPE_TEXT','SELECT','CLICK','DONE']);
  await send('Now Paris');
  assert.equal(await readResult(),'Stays in Paris for 2 guests');
  assert(plans[1].messages.some(m=>m.content.includes('London for 2 guests')));
  assert.equal(plans[1].previousGoal,'Find stays in London for 2 guests');
  const actionsBeforeQuestion=selected.length;
  await send('What did you find?');
  assert.equal(selected.length,actionsBeforeQuestion,'A conversational answer must not trigger browser mutations');
  const run=await page.evaluate(()=>window.jevry.state());
  const conversation=run.conversations.find(c=>c.id===run.activeConversationId);
  assert.equal(conversation.messages.length,6);
  assert(conversation.messages.at(-1).content.includes('Paris for 2 guests'));
  await app.evaluate(({ webContents }) => {
    const wc = webContents
      .getAllWebContents()
      .find((w) => w.getURL().includes("/fixture"));
    wc.focus();
    wc.sendInputEvent({
      type: "keyDown",
      keyCode: "L",
      modifiers: process.platform === "darwin" ? ["meta"] : ["control"],
    });
    wc.sendInputEvent({
      type: "keyUp",
      keyCode: "L",
      modifiers: process.platform === "darwin" ? ["meta"] : ["control"],
    });
  });
  await expect(
    page.getByRole("textbox", { name: "Search or enter a URL", exact: true }),
  ).toBeFocused();
  await page.getByRole('combobox',{name:'Conversation mode'}).selectOption('research');
  await send('Compare the visible stays');
  const research=await page.evaluate(()=>window.jevry.state().then(s=>s.research));
  assert.equal(research.sources[0].url,base+'/fixture');
  assert.equal(research.findings[0].sourceIds[0],'S1');
  await page.getByRole('combobox',{name:'Conversation mode'}).selectOption('auto');
  holdInference=true;
  await page.getByRole('textbox',{name:'Message Jevry'}).fill('Find more stays');
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  await expect(page.getByRole('button',{name:'Stop current task'})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.jevry.state().then(s=>s.events.some(e=>e.type==='inference'||e.type==='observation')))).toBe(true);
  await page.getByRole('textbox',{name:'Message Jevry'}).fill('Just answer what did you find already?');
  await page.getByRole('button',{name:'Send and redirect',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.jevry.state().then(s=>s.running)),{timeout:15000}).toBe(false);
  holdInference=false;
  const redirected=await page.evaluate(()=>window.jevry.state().then(s=>s.conversations.find(c=>c.id===s.activeConversationId)));
  assert.equal(redirected.messages.at(-3).status,'stopped');
  assert.equal(redirected.messages.at(-1).status,'complete');
  assert(redirected.messages.at(-1).content.includes('Paris'));
  const savedId=redirected.id;
  await page.getByRole('button',{name:'New conversation',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'Conversation history'})).not.toHaveValue(savedId);
  await page.getByRole('combobox',{name:'Conversation history'}).selectOption(savedId);
  await expect(page.getByRole('combobox',{name:'Conversation history'})).toHaveValue(savedId);
  const archive=await readFile(join(profile,'conversations.enc'));
  assert(!archive.toString().includes('Find stays in London'));
  await app.close();
  app=await electron.launch({args:process.env.JEVRY_PACKAGED_EXECUTABLE?[]:[root],executablePath:process.env.JEVRY_PACKAGED_EXECUTABLE||electronPath,env,timeout:30000});
  const reopened=await app.firstWindow();
  await reopened.waitForLoadState('domcontentloaded');
  const restored=await reopened.evaluate(()=>window.jevry.state());
  assert.equal(restored.activeConversationId,savedId);
  assert(restored.tabs.some(tab=>tab.url===base+'/fixture'),'Restored workspace must reopen the prior website');
  assert.equal(restored.conversations.find(c=>c.id===savedId).messages.length,12);
  await reopened.screenshot({path:join(root,'artifacts/conversation.png')});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,checks:['onboarding','encrypted secrets and conversations','native navigation and sandbox','two consecutive action turns preserving context','page-grounded follow-up without actions','cited research','redirect cancels old task','conversation history selection','history survives app restart'],provider:'deterministic local models; no live quality claim'},null,2));
} finally {
  if (app) await app.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await rm(profile, { recursive: true, force: true });
}
