import {EventEmitter} from 'node:events';
import type {WebContents} from 'electron';
import {describe,it,expect,vi} from 'vitest';
import {createNativeTransport} from './native-evaluator';

function fixture() {
  let attached=false,sequence=0;
  const state={frame:'frame',loader:'loader',deferContext:false,omitContext:false,wrongFrame:false,response:{result:{value:true}} as any};
  const debug=Object.assign(new EventEmitter(),{
    isAttached:()=>attached,
    attach:vi.fn(()=>{attached=true;}),
    sendCommand:vi.fn(async(method:string,_params?:Record<string,unknown>):Promise<any>=>{
      if(method==='Page.getFrameTree')return {frameTree:{frame:{id:state.frame,loaderId:state.loader}}};
      if(method==='Page.createIsolatedWorld') {
        const context={id:7,uniqueId:`unique-${++sequence}`,name:'jevry-page-evidence',auxData:{frameId:state.wrongFrame?'other':state.frame,isDefault:false,type:'isolated'}};
        if(state.omitContext)return {executionContextId:7};
        if(state.deferContext)setTimeout(()=>debug.emit('message',{},'Runtime.executionContextCreated',{context}),0);
        else debug.emit('message',{},'Runtime.executionContextCreated',{context});
        return {executionContextId:7};
      }
      if(method==='Runtime.evaluate')return state.response;
      return {};
    }),
  });
  const wc=Object.assign(new EventEmitter(),{debugger:debug,isDestroyed:()=>false});
  const transport=createNativeTransport(wc as unknown as WebContents);
  const calls=(method:string)=>debug.sendCommand.mock.calls.filter(([name])=>name===method);
  const emit=(method:string,params={})=>debug.emit('message',{},method,params);
  const detach=()=>{attached=false;debug.emit('detach',{},'test');};
  return {wc,debug,state,transport,calls,emit,detach};
}

describe('native isolated evaluation',()=>{
  it('routes explicitly scoped commands to the attached child target',async()=>{
    const f=fixture();
    await f.transport.cdp('Page.getFrameTree',{},'owned-child-session');
    expect(f.debug.sendCommand).toHaveBeenCalledWith('Page.getFrameTree',{},'owned-child-session');
    await f.transport.evaluate('1');
    expect(f.calls('Runtime.evaluate').at(-1)).toHaveLength(2);
  });
  it('reuses a named world while evaluating only by its unique ID',async()=>{
    const f=fixture();
    await f.transport.evaluate('window.registry = 1');
    await f.transport.evaluate('window.registry');
    expect(f.calls('Page.createIsolatedWorld')).toHaveLength(1);
    expect(f.calls('Runtime.enable')).toHaveLength(1);
    expect(f.calls('Page.createIsolatedWorld')[0][1]).toEqual({frameId:'frame',worldName:'jevry-page-evidence'});
    expect(f.calls('Runtime.evaluate')[1][1]).toMatchObject({uniqueContextId:'unique-1',returnByValue:true,awaitPromise:true,allowUnsafeEvalBlockedByCSP:false});
    expect(f.calls('Runtime.evaluate')[1][1]).not.toHaveProperty('contextId');
  });
  it('waits for an asynchronous context event before evaluating',async()=>{
    const f=fixture();f.state.deferContext=true;
    await expect(f.transport.evaluate('1')).resolves.toBe(true);
    expect(f.calls('Runtime.evaluate')[0][1]?.uniqueContextId).toBe('unique-1');
  });
  it('rejects a world belonging to a different frame',async()=>{
    const f=fixture();f.state.wrongFrame=true;
    await expect(f.transport.evaluate('1')).rejects.toThrow('different page context');
    expect(f.calls('Runtime.evaluate')).toHaveLength(0);
  });
  it('bounds waiting for missing context events without evaluating',async()=>{
    vi.useFakeTimers();
    try {
      const f=fixture();f.state.omitContext=true;
      const rejected=expect(f.transport.evaluate('mutate()')).rejects.toThrow('did not report');
      await vi.advanceTimersByTimeAsync(1001);
      await rejected;
      expect(f.calls('Runtime.evaluate')).toHaveLength(0);
    } finally {vi.useRealTimers();}
  });
  it('rejects navigation between the initial frame read and world creation',async()=>{
    const f=fixture(),original=f.debug.sendCommand.getMockImplementation()!;
    f.debug.sendCommand.mockImplementation(async(method,params)=>{
      const result=await original(method,params);
      if(method==='Page.createIsolatedWorld')f.state.loader='next-document';
      return result;
    });
    await expect(f.transport.evaluate('mutate()')).rejects.toThrow('navigated before evaluation');
    expect(f.calls('Runtime.evaluate')).toHaveLength(0);
  });
  it('refreshes the context when the document loader changes',async()=>{
    const f=fixture();await f.transport.evaluate('1');f.state.loader='next';
    await f.transport.evaluate('2');
    expect(f.calls('Page.createIsolatedWorld')).toHaveLength(2);
    expect(f.calls('Runtime.evaluate')[1][1]?.uniqueContextId).toBe('unique-2');
  });
  it('invalidates cached worlds on context destruction or clearing',async()=>{
    const f=fixture();await f.transport.evaluate('1');
    f.emit('Runtime.executionContextDestroyed',{executionContextId:7,executionContextUniqueId:'unique-1'});
    await f.transport.evaluate('2');
    f.emit('Runtime.executionContextsCleared');
    await f.transport.evaluate('3');
    expect(f.calls('Page.createIsolatedWorld')).toHaveLength(3);
    expect(f.calls('Runtime.evaluate')[2][1]?.uniqueContextId).toBe('unique-3');
  });
  it('reenables context reporting after debugger detach',async()=>{
    const f=fixture();await f.transport.evaluate('1');f.detach();
    await f.transport.evaluate('2');
    expect(f.debug.attach).toHaveBeenCalledTimes(2);
    expect(f.calls('Runtime.enable')).toHaveLength(2);
    expect(f.calls('Runtime.evaluate')[1][1]?.uniqueContextId).toBe('unique-2');
  });
  it('shares initialization across concurrent native commands',async()=>{
    const f=fixture();await Promise.all([f.transport.cdp('Page.getFrameTree'),f.transport.cdp('Page.getFrameTree')]);
    expect(f.debug.attach).toHaveBeenCalledOnce();
    expect(f.calls('Runtime.enable')).toHaveLength(1);
  });
  it('surfaces JavaScript exceptions without retrying a mutating expression',async()=>{
    const f=fixture();f.state.response={result:{type:'object'},exceptionDetails:{exception:{description:'mutation failed'}}};
    await expect(f.transport.evaluate('mutate()')).rejects.toThrow('mutation failed');
    expect(f.calls('Runtime.evaluate')).toHaveLength(1);
  });
  it('does not retry a rejected stale context and releases listeners on close',async()=>{
    const f=fixture();await f.transport.evaluate('1');
    f.debug.sendCommand.mockImplementation(async(method)=>{if(method==='Page.getFrameTree')return {frameTree:{frame:{id:'frame',loaderId:'loader'}}};throw new Error('Cannot find context');});
    await expect(f.transport.evaluate('mutate()')).rejects.toThrow('Cannot find context');
    expect(f.calls('Runtime.evaluate')).toHaveLength(2);
    f.wc.emit('destroyed');
    expect(f.debug.listenerCount('message')).toBe(0);
    await expect(f.transport.evaluate('1')).rejects.toThrow('closed');
  });
  it('cleans up without reading native WebContents properties after destruction',async()=>{
    const f=fixture();await f.transport.evaluate('1');
    Object.defineProperty(f.wc,'debugger',{get(){throw new TypeError('Object has been destroyed');}});
    expect(()=>f.wc.emit('destroyed')).not.toThrow();
    expect(f.debug.listenerCount('message')).toBe(0);
    expect(f.debug.listenerCount('detach')).toBe(0);
    await expect(f.transport.evaluate('1')).rejects.toThrow('closed');
  });
});
