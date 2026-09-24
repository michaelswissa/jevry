import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {monitorHostClock} from './clock-monitor.mjs';

test('synchronous setup does not appear as a host pause',async()=>{
  const events=[],watcher=monitorHostClock(event=>events.push(event),{intervalMs:10,maxGapMs:150});
  try {
    await watcher.ready;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,300);
    await delay(30);
    assert.deepEqual(events,[]);
  } finally {await watcher.close();}
});

test('a suspended process records an invalid timing interval on resume',{skip:process.platform==='win32'},async()=>{
  const moduleUrl=new URL('./clock-monitor.mjs',import.meta.url).href;
  const child=spawn(process.execPath,['--input-type=module','-e',`import {monitorHostClock} from ${JSON.stringify(moduleUrl)};
    const watcher=monitorHostClock(event=>{console.log(JSON.stringify(event));void watcher.close();},{intervalMs:10,maxGapMs:150});
    await watcher.ready;console.log('ready');`],{stdio:['ignore','pipe','pipe']});
  let output='',errors='',exited=false;
  child.stdout.setEncoding('utf8');child.stdout.on('data',part=>output+=part);
  child.stderr.setEncoding('utf8');child.stderr.on('data',part=>errors+=part);
  child.on('exit',()=>exited=true);
  const until=Date.now()+5000;
  try {
    while(!output.includes('ready')&&!exited&&Date.now()<until)await delay(10);
    assert.ok(output.includes('ready'),errors||'Clock worker did not start.');
    process.kill(child.pid,'SIGSTOP');await delay(300);process.kill(child.pid,'SIGCONT');
    while(!output.includes('host-clock-gap')&&Date.now()<until)await delay(10);
    const event=output.trim().split('\n').filter(line=>line.startsWith('{')).map(JSON.parse)[0];
    assert.equal(event?.kind,'host-clock-gap');assert.ok(event.gapMs>=250);
  } finally {child.kill('SIGCONT');child.kill('SIGTERM');}
});
