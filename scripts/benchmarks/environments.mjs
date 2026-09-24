/** Recreate only this task's pinned, disposable benchmark containers. */
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const context='colima-jevry-benchmark';
export const environments={
 shopping_admin:{ports:[7780,7781],internal:[80,8877],digest:'d0531dd27ed98d0c459ff9e88118bf2ed8b660b0ed99c38837db46c065a5be13',php:true,healthPath:'/admin'},
 shopping:{ports:[7770,7771],internal:[80,8877],digest:'3e8cb9b945ea9b1c94ab26dba53e8d12dd0406abbf4bf686fd3bb2b6a5908feb',php:true,healthPath:'/customer/account/login'},
 reddit:{ports:[9999,9998],internal:[80,8877],digest:'0594908059a03e5f610005689440a95c05e776e734006197c7b1eba12734cb46',php:true,healthPath:'/login'},
 gitlab:{ports:[8023,8024],internal:[8023,8877],digest:'673ba94d757c5b3f4bb55751ad8b745a33bad2b987349322403cbc41035a92e0',healthPath:'/users/sign_in'},
};
const docker=args=>execFileSync('docker',['--context',context,...args],{encoding:'utf8',maxBuffer:2_000_000}).trim();
export async function resetSites(sites) {
 const results=[];
 for(const site of [...new Set(sites)]) {
  const spec=environments[site];assert.ok(spec,`No pinned reset procedure for ${site}`);
  const name='jevry-benchmark-'+site.replaceAll('_','-');
  const image=`am1n3e/webarena-verified-${site}@sha256:${spec.digest}`;
  const ids=docker(['ps','-aq','--filter',`name=^/${name}$`]);
  if(ids) {
   const current=JSON.parse(docker(['inspect',name]))[0];
   assert.equal(current.Config.Image,image,`Refusing to remove an unexpected container ${name}`);
   docker(['rm','-f',name]);
  }
  // Official container manager passes this to entrypoint initialization. A
  // healthy service alone can still contain the image's original base URL.
  const baseUrl=`http://localhost:${spec.ports[0]}`;
  const args=['run','-d','--name',name,'--label','app.jevry.purpose=benchmark','--platform','linux/amd64','-e',`WA_ENV_CTRL_EXTERNAL_SITE_URL=${baseUrl}`];
  for(const [i,port]of spec.ports.entries())args.push('-p',`127.0.0.1:${port}:${spec.internal[i]}`);
  if(site==='gitlab')args.push('--shm-size','2g');
  const id=docker([...args,image]);
  if(spec.php) {
   docker(['cp',resolve(import.meta.dirname,'php-arm64.ini'),name+':/usr/local/etc/php/conf.d/zz-apple-rosetta.ini']);
   // Service discovery may not yet be ready; the copied setting is used at boot.
   try{docker(['exec',name,'supervisorctl','restart','php-fpm']);}catch{}
  }
  const until=Date.now()+300000;let healthy=false;
  while(Date.now()<until) {
   try{const response=await fetch(`http://localhost:${spec.ports[1]}/status`,{signal:AbortSignal.timeout(5000)});healthy=(await response.json()).success===true;}catch{}
   if(healthy&&spec.php){
    let initStatus='';try{initStatus=docker(['exec',name,'supervisorctl','status','env-ctrl-init']);}catch(error){initStatus=String(error.stdout||'');}
    healthy=/\bEXITED\b/.test(initStatus);
   }
   if(healthy)break;await new Promise(r=>setTimeout(r,1500));
  }
  assert.ok(healthy,`${name} did not become healthy`);
  // Verify initialization explicitly after the startup job finishes. This is
  // the unchanged official setup operation, before the actor is launched.
  const initialized=JSON.parse(docker(['exec',name,'env-ctrl','--verbose','init','--base-url',baseUrl]));
  assert.equal(initialized.success,true,`${name} initialization failed`);
  let externalReady=false;
  while(Date.now()<until){
   try{const response=await fetch(baseUrl+spec.healthPath,{redirect:'manual',signal:AbortSignal.timeout(10000)});await response.body?.cancel();externalReady=response.status>=200&&response.status<400;}catch{}
   if(externalReady)break;await new Promise(r=>setTimeout(r,1500));
  }
  assert.ok(externalReady,`${name} public starting page is not ready`);
  const record={site,id,image,baseUrl,initialized:true,externalReady,resetAt:new Date().toISOString(),compatibility:spec.php?'OPcache disabled on Apple Rosetta':'none'};
  results.push(record);console.log(JSON.stringify(record));
 }
 return results;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const sites=process.argv.find(arg=>arg.startsWith('--sites='))?.slice(8).split(',');
 assert.ok(sites?.length,'Specify --sites=reddit (disposable benchmark containers only).');
 await resetSites(sites);
}
