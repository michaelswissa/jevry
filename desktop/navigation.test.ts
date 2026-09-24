import {EventEmitter} from 'node:events';
import {describe,it,expect,vi} from 'vitest';
import type {WebContents} from 'electron';
import {navigateReady} from './navigation';
function browser(){return Object.assign(new EventEmitter(),{loadURL:vi.fn(()=>new Promise<void>(()=>{})),getURL:()=> 'https://example.test',stop:vi.fn()});}
describe('agent navigation readiness',()=>{
 it('begins on DOM readiness without waiting for slow subresources',async()=>{
   const wc=browser();const ready=navigateReady(wc as unknown as WebContents,'https://example.test',new AbortController().signal);wc.emit('dom-ready');await ready;expect(wc.listenerCount('dom-ready')).toBe(0);expect(wc.stop).not.toHaveBeenCalled();
 });
 it('stops native loading and removes listeners on cancellation',async()=>{
   const wc=browser(),controller=new AbortController();const ready=navigateReady(wc as unknown as WebContents,'https://example.test',controller.signal);controller.abort();await expect(ready).rejects.toThrow('Stopped');expect(wc.stop).toHaveBeenCalledOnce();expect(wc.listenerCount('did-fail-load')).toBe(0);
 });
 it('reports a main-frame failure instead of reading the browser error page',async()=>{
   const wc=browser();const ready=navigateReady(wc as unknown as WebContents,'https://example.test',new AbortController().signal);wc.emit('did-fail-load',{},-105,'ERR_NAME_NOT_RESOLVED','https://example.test',true);await expect(ready).rejects.toThrow('ERR_NAME_NOT_RESOLVED');
 });
});
