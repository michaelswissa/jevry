/** Real Jevry UI + real providers, official public task inputs, separate upstream grading. */
import {_electron as electron} from '@playwright/test';
import electronPath from 'electron';
import {readFile,writeFile,mkdir,mkdtemp,copyFile,chmod,rm} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {tmpdir,homedir} from 'node:os';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {publicTask,taskPrompt,parseResponse} from './agent-input.mjs';
import {recordBrowser} from './record-browser.mjs';
import {bootstrapGitLab} from './bootstrap-auth.mjs';
import {resetSites} from './environments.mjs';
import {monitorHostClock} from './clock-monitor.mjs';

const root=resolve(import.meta.dirname,'../..');
const option=name=>process.argv.find(arg=>arg.startsWith(`--${name}=`))?.slice(name.length+3);
const resetBeforeEachTask=process.argv.includes('--reset-sites');
const inputs=JSON.parse(await readFile(resolve(root,option('inputs')||'artifacts/webarena-agent-inputs.json'),'utf8')).map(publicTask);
const ids=option('tasks')?.split(',').map(Number);
assert.ok(ids?.length && ids.every(Number.isInteger),'Specify a frozen task list with --tasks=0,11,41.');
const selected=ids.map(id=>{const task=inputs.find(t=>t.task_id===id);assert.ok(task,`Unknown task ${id}`);return task;});
assert.equal(new Set(ids).size,ids.length,'Each task occurs once per run. Use another output directory for retries.');
assert.ok(process.argv.includes('--run-live'),'Use --run-live to consume the saved providers for actual tasks.');
const output=resolve(root,option('output')||`artifacts/webarena/${new Date().toISOString().replaceAll(':','-')}`);
await mkdir(dirname(output),{recursive:true});await mkdir(output); // Refuse to overwrite an attempt.
const config=JSON.parse(await readFile(join(root,'scripts/benchmarks/webarena.config.json'),'utf8'));
const origins=[...new Set(selected.flatMap(task=>task.sites.flatMap(site=>config.environments[`__${site.toUpperCase()}__`].urls.map(url=>new URL(url).origin))))];
const headerNames={shopping_admin:'X-M2-Admin-Auto-Login',shopping:'X-M2-Customer-Auto-Login',reddit:'X-Postmill-Auto-Login'};
const authHeaders={};
for(const task of selected) for(const site of task.sites) {
  const environment=config.environments[`__${site.toUpperCase()}__`];
  if(environment.credentials && headerNames[site])for(const url of environment.urls)authHeaders[new URL(url).origin]={[headerNames[site]]:`${environment.credentials.username}:${environment.credentials.password}`};
}
const sha=data=>createHash('sha256').update(data).digest('hex');
const sourceFiles=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','desktop','src','scripts/benchmarks'],{cwd:root,encoding:'utf8'}).trim().split('\n');
const report={startedAt:new Date().toISOString(),benchmark:'WebArena-Verified',scope:'development run; not a leaderboard submission',fullSuiteTasks:812,taskIds:ids,commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),dirty:!!execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),benchmarkCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:join(root,'upstream/webarena-verified'),encoding:'utf8'}).trim(),sourceHashes:Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,sha(await readFile(join(root,file)))]))),turns:[]};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
report.resetBeforeEachTask=resetBeforeEachTask;
report.hostInterruptions=[];
const clock=monitorHostClock(event=>{report.hostInterruptions.push(event);console.log(JSON.stringify(event));});
await clock.ready;
const save=()=>writeFile(join(output,'run.json'),JSON.stringify(report,null,2)+'\n');
try {
await save();
for(const task of selected) {
  if(report.hostInterruptions.length)break;
  const taskOrigins=[...new Set(task.sites.flatMap(site=>config.environments[`__${site.toUpperCase()}__`].urls.map(url=>new URL(url).origin)))];
  const taskDir=join(output,String(task.task_id));await mkdir(taskDir);
  const profile=await mkdtemp(join(tmpdir(),'jevry-webarena-'));
  const record={taskId:task.task_id,startedAt:new Date().toISOString(),status:'starting'};report.turns.push(record);await save();
  let app,page;
  try {
    if(resetBeforeEachTask){record.environmentReset=await resetSites(task.sites);await save();}
    if(report.hostInterruptions.length)throw new Error('Host timing was interrupted during environment setup. Start a new attempt.');
    await copyFile(process.env.JEVRY_CONNECTION_SOURCE||join(homedir(), 'Library', 'Application Support', 'Jevry', 'connections.enc'),join(profile,'connections.enc'));
    await chmod(join(profile,'connections.enc'),0o600);
    const env={...process.env,JEVRY_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;delete env.JEVRY_DEV_URL;
    const packaged=process.env.JEVRY_PACKAGED_EXECUTABLE;
    app=await electron.launch({executablePath:packaged||electronPath,args:packaged?[]:[root],env,timeout:30000});
    page=await app.firstWindow();await page.waitForFunction(()=>typeof window.jevry?.state==='function');
    const appPath=await app.evaluate(({app})=>app.getAppPath());
    const {extractFile}=createRequire(import.meta.url)('@electron/asar');
    record.bundleSha256=sha(appPath.endsWith('.asar')?extractFile(appPath,'dist-desktop/main.cjs'):await readFile(join(appPath,'dist-desktop/main.cjs')));
    const state=await page.evaluate(()=>window.jevry.state());
    assert.ok(state.settings.jev.connected && state.settings.text.connected,'Both saved model connections are required.');
    record.providers={text:state.settings.text.provider,textModel:state.settings.text.model,jevModel:state.settings.jev.model};
    await page.evaluate(()=>window.jevry.finishSetup());
    if(task.sites.includes('gitlab'))await bootstrapGitLab(app,config.environments.__GITLAB__);
    await app.evaluate(recordBrowser,{origins:taskOrigins,authHeaders:Object.fromEntries(Object.entries(authHeaders).filter(([origin])=>taskOrigins.includes(origin)))});
    // Bootstrap consists only of the officially supplied starting URLs and login headers.
    for(const [i,url] of task.start_urls.entries())await page.evaluate(async({url,i})=>i?window.jevry.newTab(url):window.jevry.navigate(url),{url,i});
    await page.evaluate(()=>window.jevry.newConversation());
    const prompt=taskPrompt(task);await writeFile(join(taskDir,'agent-input.txt'),prompt);
    const started=performance.now();
    const accepted=await page.evaluate(text=>window.jevry.sendMessage({text,mode:'auto'}),prompt);assert.equal(accepted.ok,true,accepted.message);
    const events=new Map();let answer,lastProgress=0;
    while(performance.now()-started<Number(option('timeout-ms')||240000)) {
      if(report.hostInterruptions.length){record.timingInvalid=true;break;}
      const state=await page.evaluate(()=>window.jevry.state());
      answer=state.conversations.find(c=>c.id===state.activeConversationId)?.messages.find(m=>m.replyTo===accepted.id);
      for(const event of answer?.events||[])events.set(JSON.stringify(event),event);
      if(answer&&!state.running&&['complete','error','stopped'].includes(answer.status))break;
      if(performance.now()-lastProgress>15000){lastProgress=performance.now();console.log(JSON.stringify({taskId:task.task_id,elapsedMs:Math.round(performance.now()-started),lastEvent:[...events.values()].at(-1)?.message}));}
      await pause(200);
    }
    if((await page.evaluate(()=>window.jevry.state())).running){record.timeout=true;await page.evaluate(()=>window.jevry.stop());}
    record.durationMs=Math.round(performance.now()-started);record.status=answer?.status||'timeout';record.answer=answer?.content||'';record.error=answer?.error;record.events=[...events.values()];
    if(record.timingInvalid)record.status='host-interrupted';
    await writeFile(join(taskDir,'agent_response.txt'),record.answer);
    const response=parseResponse(record.answer);
    await writeFile(join(taskDir,'agent_response.json'),response?JSON.stringify(response,null,2):record.answer);
    console.log(JSON.stringify({taskId:task.task_id,status:record.status,durationMs:record.durationMs,actions:record.events.filter(e=>e.type==='action').length,answer:record.answer}));
  } catch(error) {record.status='runner-error';record.error=error.message;console.log(JSON.stringify({taskId:task.task_id,error:record.error}));}
  finally {
    if(page)await page.evaluate(()=>window.jevry.stop()).catch(()=>{});
    if(app) {
      const trace=await app.evaluate(async()=>globalThis.__benchmarkDump?globalThis.__benchmarkDump():null).catch(error=>({captureError:error.message}));
      if(trace?.har)await writeFile(join(taskDir,'network.har'),JSON.stringify(trace.har));
      if(trace?.decisions)await writeFile(join(taskDir,'trajectory.jsonl'),trace.decisions.map(row=>JSON.stringify(row)).join('\n')+'\n');
      if(trace?.captureError)record.captureError=trace.captureError;
      const frames=await app.evaluate(async({webContents},origins)=>Promise.all(webContents.getAllWebContents().filter(w=>origins.some(origin=>w.getURL().startsWith(origin+'/'))).map(async w=>({url:w.getURL(),png:(await w.capturePage()).toPNG().toString('base64')}))),origins).catch(()=>[]);
      for(const [i,frame] of frames.entries())await writeFile(join(taskDir,`final-${i}.png`),Buffer.from(frame.png,'base64'));
      await app.close().catch(()=>app.process().kill('SIGKILL'));
    }
    await rm(profile,{recursive:true,force:true});await save();
  }
  // Infrastructure failures need a new attempt, not more invalid timed tasks.
  if(record.status==='runner-error'||report.hostInterruptions.length)break;
}
} finally {await clock.close();}
report.unattemptedTaskIds=ids.filter(id=>!report.turns.some(turn=>turn.taskId===id));
report.finishedAt=new Date().toISOString();
report.sourceDrift=[];for(const [file,hash] of Object.entries(report.sourceHashes))if(sha(await readFile(join(root,file)))!==hash)report.sourceDrift.push(file);
await save();
console.log(JSON.stringify({output,tasks:report.turns.length,grading:'Run the unchanged upstream eval-tasks command on this directory.'}));
