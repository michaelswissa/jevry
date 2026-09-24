import {Worker} from 'node:worker_threads';

/** Observe host pauses independently of synchronous Docker setup in the runner. */
export function monitorHostClock(onGap, {intervalMs=1000,maxGapMs=10000}={}) {
  const worker=new Worker(`
    const {parentPort,workerData}=require('node:worker_threads');
    let previous=Date.now();
    setInterval(()=>{
      const now=Date.now(),gapMs=now-previous;
      if(gapMs>workerData.maxGapMs||gapMs<0)
        parentPort.postMessage({kind:'host-clock-gap',previousAt:new Date(previous).toISOString(),observedAt:new Date(now).toISOString(),gapMs});
      previous=now;
    },workerData.intervalMs);
    parentPort.postMessage({kind:'ready'});
  `,{eval:true,execArgv:[],workerData:{intervalMs,maxGapMs}});
  const ready=new Promise((resolve,reject)=>{
    worker.once('error',reject);
    worker.on('message',event=>event.kind==='ready'?resolve():onGap(event));
  });
  return {ready,close:()=>worker.terminate()};
}
