import {beforeEach,describe,it,expect,vi} from 'vitest';
import {OwnedTurnWork} from './turn-work';
import {Conversations} from './conversation';
import {researchTabs,type ResearchTab} from './research';
import {generatePlan} from './providers';

vi.mock('./providers',()=>({generatePlan:vi.fn()}));
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};};
const eventually=async(predicate:()=>boolean)=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}throw new Error('Timed out');};
beforeEach(()=>{vi.mocked(generatePlan).mockReset();});

describe('turn-owned serial work',()=>{
  it('serializes work and retains each operation result',async()=>{
    const queue=new OwnedTurnWork(new AbortController().signal),hold=deferred(),started=deferred(),order:string[]=[];
    const first=queue.run(async()=>{order.push('first start');started.resolve();await hold.promise;order.push('first finish');return 1;});
    const second=queue.run(async()=>{order.push('second');return 2;});
    await started.promise;expect(order).toEqual(['first start']);
    hold.resolve();expect(await first).toBe(1);expect(await second).toBe(2);
    await queue.closeAndDrain();expect(order).toEqual(['first start','first finish','second']);
  });

  it('closes immediately, skips queued work, and waits for already-started cleanup',async()=>{
    const queue=new OwnedTurnWork(new AbortController().signal),hold=deferred(),started=deferred();
    let cleanupFinished=false,drained=false;
    const first=queue.run(async()=>{started.resolve();try{await hold.promise;}finally{cleanupFinished=true;}});
    await started.promise;
    const queuedWork=vi.fn(async()=>{}),queued=queue.run(queuedWork);
    const rejected=expect(queued).rejects.toThrow('turn is closed');
    const closing=queue.closeAndDrain().then(()=>{drained=true;});
    await expect(queue.run(async()=>{})).rejects.toThrow('turn is closed');
    expect(drained).toBe(false);expect(cleanupFinished).toBe(false);expect(queuedWork).not.toHaveBeenCalled();
    hold.resolve();await first;await rejected;await closing;
    expect(cleanupFinished).toBe(true);expect(drained).toBe(true);expect(queuedWork).not.toHaveBeenCalled();
    await queue.closeAndDrain();
  });

  it('rechecks cancellation before queued work starts',async()=>{
    const controller=new AbortController(),queue=new OwnedTurnWork(controller.signal),work=vi.fn(async()=>{});
    const queued=queue.run(work);controller.abort();
    await expect(queued).rejects.toMatchObject({name:'AbortError'});
    await expect(queue.run(work)).rejects.toMatchObject({name:'AbortError'});
    await queue.closeAndDrain();expect(work).not.toHaveBeenCalled();
  });

  it('retains operation errors without poisoning later work or drainage',async()=>{
    const queue=new OwnedTurnWork(new AbortController().signal),failure=new Error('Fixture failed after cleanup');
    const first=queue.run(async()=>{throw failure;});
    const second=queue.run(async()=>42);
    await expect(first).rejects.toBe(failure);await expect(second).resolves.toBe(42);
    await expect(queue.closeAndDrain()).resolves.toBeUndefined();
  });
});

describe('research cancellation drains verification before a conversation redirect',()=>{
  it('holds the actual Conversations executor until verification cleanup finishes despite interruptible read cancellation',async()=>{
    const providerStarted=deferred(),cleanupEntered=deferred(),releaseCleanup=deferred(),researchCancelled=deferred();
    const order:string[]=[],startedTurns:string[]=[];
    let queue:OwnedTurnWork|undefined,queuedVerificationRan=false,drainFinished=false;
    const service=new Conversations({conversations:[],activeConversationId:null},async ctx=>{
      startedTurns.push(ctx.message.content);
      if(ctx.message.content==='Redirect') {order.push('redirect started');ctx.update('Redirect finished.');return;}
      queue=new OwnedTurnWork(ctx.signal);
      const page=(id:string)=>({title:id,url:`https://fixture.test/${id}`,text:'Fixture evidence'});
      const tabs:ResearchTab[]=[
        {id:'first',...page('first'),read:()=>queue!.run(async()=>{
          order.push('verification started');providerStarted.resolve();
          try {
            await new Promise<void>(resolve=>ctx.signal.addEventListener('abort',()=>resolve(),{once:true}));
          } finally {
            // The provider has observed cancellation, but its process/input
            // cleanup still owns this tab until this promise settles.
            cleanupEntered.resolve();await releaseCleanup.promise;order.push('verification cleanup finished');
          }
          ctx.signal.throwIfAborted();return page('first');
        })},
        {id:'second',...page('second'),read:()=>queue!.run(async()=>{queuedVerificationRan=true;return page('second');})},
      ];
      try {
        await researchTabs({goal:'Compare these sources',tabs,textConfig:{provider:'openai',apiKey:'fixture-only'},signal:ctx.signal,emit:ctx.event});
      } catch(error) {
        expect(ctx.signal.aborted).toBe(true);order.push('research read cancelled');researchCancelled.resolve();throw error;
      } finally {
        await queue.closeAndDrain();drainFinished=true;order.push('turn work drained');
      }
    },()=>{},()=>{});

    expect(service.send({text:'Research'}).ok).toBe(true);await providerStarted.promise;
    expect(service.send({text:'Redirect'}).ok).toBe(true);
    await Promise.all([researchCancelled.promise,cleanupEntered.promise]);
    expect(service.running).toBe(true);expect(startedTurns).toEqual(['Research']);
    expect(drainFinished).toBe(false);expect(queuedVerificationRan).toBe(false);
    expect(service.active()!.messages.at(-1)?.status).toBe('queued');
    await expect(queue!.run(async()=>{})).rejects.toMatchObject({name:'AbortError'});

    releaseCleanup.resolve();await eventually(()=>!service.running);
    expect(startedTurns).toEqual(['Research','Redirect']);expect(drainFinished).toBe(true);
    expect(queuedVerificationRan).toBe(false);
    expect(order.indexOf('verification cleanup finished')).toBeLessThan(order.indexOf('turn work drained'));
    expect(order.indexOf('turn work drained')).toBeLessThan(order.indexOf('redirect started'));
    expect(service.active()!.messages[1].status).toBe('stopped');
    expect(service.active()!.messages.at(-1)).toMatchObject({status:'complete',content:'Redirect finished.'});
    expect(generatePlan).not.toHaveBeenCalled();
  });
});
