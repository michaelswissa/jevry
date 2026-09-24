/** One real vision request on an owned local image. No inference without --run-live. */
import { build } from 'esbuild';
import electronPath from 'electron';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const live = process.argv.includes('--run-live');
const outputArg = process.argv.find(arg => arg.startsWith('--output='))?.slice('--output='.length);
const output = resolve(root, outputArg || 'artifacts/live-vision-beta.json');
if (!live) {
  console.log(JSON.stringify({ status: 'not-run', liveInference: false, modelRequests: 0,
    instruction: 'Pass --run-live to make exactly one real Claude image request; no retries.' }));
  process.exit(0);
}
const workspace = await mkdtemp(join(tmpdir(), 'jevry-live-vision-'));
const profile = join(workspace, 'profile');
const temporary = join(workspace, 'temp');
await mkdir(profile); await mkdir(temporary);
const report = {
  generatedAt: new Date().toISOString(), scope: 'owned synthetic image; real Claude CLI image transport, not CAPTCHA acceptance',
  provider: 'claude', configuredModel: null, modelOverride: false, automaticRetries: 0,
  liveInference: true, modelRequests: 0, isolatedProfile: true, accountFilesReadByHarness: false,
  imagePersistedByHarness: false, passed: false, sourceHashes: {}, cleanup: { ok: false },
};
for (const path of ['desktop/providers.ts', 'desktop/cli-worker.ts', 'scripts/test-live-vision.mjs']) {
  report.sourceHashes[path] = createHash('sha256').update(await readFile(join(root, path))).digest('hex');
}
const fixture = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>
html,body{margin:0;width:420px;height:320px;overflow:hidden;background:#faf8f0}
.shape{position:absolute;box-sizing:border-box}.blue{left:68px;top:84px;width:52px;height:52px;background:#1454eb;border-radius:50%}
.green{left:195px;top:110px;width:52px;height:52px;background:#08ba39}
.red{left:294px;top:184px;width:0;height:0;border-left:25px solid transparent;border-right:25px solid transparent;border-bottom:45px solid #ed223a}
.checkbox{left:101px;top:221px;width:24px;height:24px;border:3px solid #242424;background:white}
</style></head><body><div class="shape blue"></div><div class="shape green"></div><div class="shape red"></div><div class="shape checkbox"></div></body></html>`;
const entry = `
const {app,BrowserWindow,session}=require('electron');
const {mkdir,readdir}=require('node:fs/promises');
const {join}=require('node:path');
const {generateVisionPlan,getProviderDiagnostics,stopProviderProcesses}=require(${JSON.stringify(join(root, 'desktop/providers.ts'))});
app.setName('Jevry Vision Acceptance');
app.setPath('userData',${JSON.stringify(profile)});
app.setPath('sessionData',${JSON.stringify(profile)});
app.setPath('logs',${JSON.stringify(join(profile, 'logs'))});
process.once('SIGTERM',()=>{stopProviderProcesses();app.exit(1);});
let win,requests=0;
const record={};
const publicResult=()=>process.stdout.write('JEVRY_VISION_RESULT '+JSON.stringify(record)+'\\n');
app.whenReady().then(async()=>{
  try{
    win=new BrowserWindow({show:false,width:420,height:320,useContentSize:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,partition:'vision-acceptance'}});
    win.webContents.session.setPermissionRequestHandler((_wc,_p,done)=>done(false));
    win.webContents.session.setPermissionCheckHandler(()=>false);
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(${JSON.stringify(fixture)}));
    await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const crop={x:40,y:40,width:320,height:220};
    let screenshot=(await win.webContents.capturePage(crop)).toPNG();
    const width=screenshot.readUInt32BE(16),height=screenshot.readUInt32BE(20);
    if(!width||!height||screenshot.length>5*1024*1024)throw new Error('Synthetic screenshot preflight failed.');
    record.image={mimeType:'image/png',width,height,bytes:screenshot.length,cropped:true};
    record.targetBounds={left:155*width/320,top:70*height/220,right:207*width/320,bottom:122*height/220};
    record.runtime={electron:process.versions.electron,chrome:process.versions.chrome,node:process.versions.node,platform:process.platform,arch:process.arch};
    const prompt='The attached synthetic image contains several colored shapes and a checkbox. Return the center pixel coordinate of the green square. Image dimensions are '+width+' by '+height+' pixels. Return only exactly {"x":integer,"y":integer}. Coordinates are relative to this attached image, starting at its top-left. Do not use tools or perform any actions.';
    const started=performance.now();requests++;
    let raw=await generateVisionPlan({provider:'claude'},prompt,{mimeType:'image/png',data:screenshot.toString('base64')},new AbortController().signal);
    screenshot.fill(0);screenshot=undefined;
    record.durationMs=Math.round(performance.now()-started);
    const diagnostics=getProviderDiagnostics();record.resolvedModel=diagnostics?.model;record.mode=diagnostics?.mode;
    let value;try{value=JSON.parse(raw);}catch{throw new Error('Model returned invalid coordinate JSON.');}raw='';
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='x,y'||!Number.isInteger(value.x)||!Number.isInteger(value.y))throw new Error('Model returned an invalid coordinate schema.');
    record.coordinate={x:value.x,y:value.y};
    const b=record.targetBounds;
    record.passed=value.x>b.left&&value.x<b.right&&value.y>b.top&&value.y<b.bottom;
    if(!record.passed)record.error='Model coordinate fell outside the green target.';
    record.modelIdentityRecorded=typeof record.resolvedModel==='string';
    if(!record.modelIdentityRecorded){record.passed=false;record.error='Provider did not report its resolved model.';}
  }catch(error){
    record.passed=false;
    record.error=error?.name==='AbortError'?'Request cancelled.':String(error?.message||'Vision acceptance failed.').replace(/\\bsk-[A-Za-z0-9_-]+/g,'[redacted]').slice(0,400);
    if(/[A-Za-z0-9+/]{80,}|\\/(?:Users|private|var)\\//.test(record.error))record.error='Vision acceptance failed; sensitive provider detail omitted.';
  }finally{
    record.modelRequests=requests;
    stopProviderProcesses();
    if(win&&!win.isDestroyed())win.destroy();
    record.providerTemporaryEntriesRemaining=(await readdir(${JSON.stringify(temporary)})).filter(name=>/^jevry-(?:vision|text)-/.test(name)).length;
    record.providerWorkspaceRemoved=record.providerTemporaryEntriesRemaining===0;
    publicResult();
    app.exit(record.passed&&record.providerWorkspaceRemoved?0:1);
  }
}).catch(()=>{record.passed=false;record.error='Electron fixture initialization failed.';record.modelRequests=requests;publicResult();app.exit(1);});
`;
let child, timer, escalation;
try {
  const entryPath = join(workspace, 'vision-main.cjs');
  await build({ stdin: { contents: entry, resolveDir: root, loader: 'js' }, outfile: entryPath,
    bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], logLevel: 'silent' });
  const env = { ...process.env, TMPDIR: temporary, TMP: temporary, TEMP: temporary };
  delete env.ELECTRON_RUN_AS_NODE; delete env.JEVRY_DEV_URL; delete env.JEVRY_TEST_PROFILE; delete env.JEVRY_TOOLS_DIR;
  const result = await new Promise((resolveResult, reject) => {
    child = spawn(electronPath, [entryPath], { cwd: workspace, env, windowsHide: true, shell: false,
      detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'ignore'] });
    let buffer = '', parsed;
    const kill = signal => { try { if(process.platform !== 'win32' && child.pid)process.kill(-child.pid,signal);else child.kill(signal); } catch {} };
    timer = setTimeout(() => { report.harnessTimedOut = true; kill('SIGTERM'); escalation=setTimeout(()=>kill('SIGKILL'),1000); }, 45_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk;
      if(buffer.length>64_000){kill('SIGTERM');return;}
      const lines=buffer.split('\n');buffer=lines.pop()||'';
      for(const line of lines)if(line.startsWith('JEVRY_VISION_RESULT ')){
        try{parsed=JSON.parse(line.slice('JEVRY_VISION_RESULT '.length));}catch{}
      }
    });
    child.once('error',()=>reject(new Error('Could not start the isolated Electron vision test.')));
    child.once('close',(code,signal)=>resolveResult({code,signal,parsed}));
  });
  report.exitCode=result.code;report.exitSignal=result.signal;
  if(result.parsed)Object.assign(report,result.parsed);
  else report.error=report.harnessTimedOut?'Isolated vision harness exceeded its deadline.':'Isolated vision harness returned no public result.';
  report.passed=report.passed&&result.code===0&&report.providerWorkspaceRemoved===true;
}catch(error){report.error=error.message;report.passed=false;}
finally{
  clearTimeout(timer);clearTimeout(escalation);
  try{await rm(workspace,{recursive:true,force:true});report.cleanup={ok:true,isolatedProfileRemoved:true,temporaryWorkspaceRemoved:true};}
  catch{report.cleanup={ok:false,isolatedProfileRemoved:false,temporaryWorkspaceRemoved:false};report.passed=false;}
  report.finishedAt=new Date().toISOString();
  await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
  if(!report.passed)process.exitCode=1;
}
