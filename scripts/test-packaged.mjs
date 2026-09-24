import {readdir,readFile,access} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';

const require=createRequire(import.meta.url);
const {extractFile}=require('@electron/asar');
const root=resolve(process.env.JEVRY_RELEASE_DIR||'release');
const entries=await readdir(root,{withFileTypes:true});
const candidates=[];
for(const entry of entries.filter(entry=>entry.isDirectory())) {
  const dir=join(root,entry.name);
  if(process.platform==='darwin'&&/^mac(?:-|$)/.test(entry.name))candidates.push({binary:join(dir,'Jevry.app/Contents/MacOS/Jevry'),asar:join(dir,'Jevry.app/Contents/Resources/app.asar')});
  if(process.platform==='win32'&&/^win(?:-|$)/.test(entry.name))candidates.push({binary:join(dir,'Jevry.exe'),asar:join(dir,'resources/app.asar')});
}
const existing=[];
for(const candidate of candidates){try{await access(candidate.binary);await access(candidate.asar);existing.push(candidate);}catch{}}
assert.equal(existing.length,1,'Choose a release directory with exactly one packaged app for this platform.');
const target=existing[0];
const sourcePackage=JSON.parse(await readFile('package.json','utf8'));
const embeddedPackage=JSON.parse(extractFile(target.asar,'package.json').toString());
assert.equal(embeddedPackage.version,sourcePackage.version,'Packaged version must match current source.');
for(const path of ['dist-desktop/main.cjs','dist-desktop/preload.cjs','dist/index.html']) {
  assert(extractFile(target.asar,path).equals(await readFile(path)),`Packaged ${path} must match the tested build.`);
}
for(const script of ['smoke-desktop.mjs','smoke-research.mjs','smoke-challenges.mjs']) {
  await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[join('scripts',script)],{stdio:'inherit',env:{...process.env,JEVRY_PACKAGED_EXECUTABLE:target.binary}});
    child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`${script} failed with exit ${code}`)));
  });
}
console.log(JSON.stringify({ok:true,version:embeddedPackage.version,platform:process.platform,binary:target.binary,checks:['embedded build identity','packaged conversation workflow','packaged research workflow','packaged verification workflow']},null,2));
