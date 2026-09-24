import { describe, it, expect, vi } from 'vitest';
import { PNG } from 'pngjs';
import { GameStrategy, parseGamePlan } from './game-strategy';
import { GridReader, decodeGameImage, gridFacts, validMotion } from './game-perception';
import { attentionReason, buildJevRequest, type BrowserAdapter, type PageState } from './engine';

const page:PageState={url:'https://game.test',title:'Game',text:'Score 0',w:200,h:200,marker:[1],page_key:[1],guards:{},actions:[
 {id:'key',node:4,kind:'key',key:'ArrowRight',role:'canvas',label:'Board → ArrowRight'},
 {id:'point',node:4,kind:'point',role:'canvas',label:'Board → click'},
]};
const layout={target:'1',rows:2,columns:2,bounds:{x:0,y:0,width:1,height:1},cells:[['empty','player'],['car','empty']]};
const config={provider:'openai' as const};
const request=()=>buildJevRequest(page,'Win the game',[],undefined,true);
const plan=(grid:unknown=layout)=>JSON.stringify({strategy:'Move toward the exit and avoid cars.',observation:'A blue player and red car on a grid.',controls:['arrows','pointer'],grid});
const colors:Record<string,number[]>={empty:[240,240,240],player:[0,0,220],car:[220,0,0],new:[0,220,0]};
function png(cells=layout.cells) {
 const image=new PNG({width:200,height:200});
 for(let y=0;y<200;y++)for(let x=0;x<200;x++){const i=(y*200+x)*4,c=colors[cells[Math.floor(y/100)][Math.floor(x/100)]];image.data[i]=c[0];image.data[i+1]=c[1];image.data[i+2]=c[2];image.data[i+3]=255;}
 return PNG.sync.write(image).toString('base64');
}
function browser() {
 let data=png();
 const adapter:BrowserAdapter={evaluate:async<T>()=>[{node:4,rect:{x:0,y:0,width:200,height:200}}] as T,cdp:vi.fn(async()=>({data})),url:()=>page.url,navigate:async()=>{}};
 return {adapter,set:(cells:string[][])=>{data=png(cells);}};
}

describe('Jev game strategy fast path',()=>{
 it('checks a visibly completed bounded task before more input and releases that gate after failed verification',async()=>{
   const f=browser();let complete=true;
   const strategy=new GameStrategy(async()=>JSON.stringify({...JSON.parse(plan(null)),outcome:complete?'won':'ongoing'}));
   const done=await strategy.prepare(f.adapter,page,request(),'Inspect the requested position','task',[],config);
   expect(Object.keys(done.request.body.questions)).toEqual(['operation']);
   expect(Object.keys(done.request.body.questions.operation.criteria)).toEqual(['DONE','BLOCKED']);
   expect(strategy.completionObservation(page,[])).toBe('A blue player and red car on a grid.');
   expect(strategy.completionObservation({...page,url:'https://other.test'},[])).toBeUndefined();
   expect(strategy.completionObservation({...page,page_key:[2]},[])).toBeUndefined();
   expect(strategy.completionObservation({...page,game_overlay:true},[])).toBeUndefined();
   expect(strategy.completionObservation({...page,actions:[...page.actions,{id:'new',kind:'click',node:22,label:'Changed province'}]},[])).toBeUndefined();
   expect(strategy.completionObservation(page,[{action:'new input',kind:'click',page_changed:true}])).toBeUndefined();
   complete=false;strategy.invalidate();
   expect(strategy.completionObservation(page,[])).toBeUndefined();
   const retry=await strategy.prepare(f.adapter,page,request(),'Inspect the requested position','task',[],config);
   expect(retry.request.body.questions.operation.criteria.KEY_RIGHT).toBeDefined();
 });
 it('uses native surface copies when available and never requests clipped CDP viewport captures',async()=>{
   const f=browser(),capture=vi.fn(async()=>({data:png()}));f.adapter.captureImage=capture;
   const strategy=new GameStrategy(async()=>plan());
   await strategy.prepare(f.adapter,page,request(),'Win','win',[],config);
   await strategy.prepare(f.adapter,page,request(),'Win','win',[],config);
   expect(capture).toHaveBeenCalledTimes(2);expect(f.adapter.cdp).not.toHaveBeenCalled();
   delete f.adapter.captureImage;
   await strategy.prepare(f.adapter,page,request(),'Win','win',[],config);
   expect(f.adapter.cdp).toHaveBeenCalledWith('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});
 });
 it('looks up missing game knowledge once, caches the guide and leaves moves to Jev',async()=>{
   const f=browser();let calls=0;
   const infer=vi.fn(async(_config,prompt)=>{calls++;if(calls===2)expect(prompt).toContain('Use the hint control');return calls===1?JSON.stringify({...JSON.parse(plan()),helpQuery:'Example game hint rules'}):plan();});
   const strategy=new GameStrategy(infer),lookup=vi.fn(async()=>[{title:'Guide',url:'https://guide.example',text:'Use the hint control'}]);strategy.setHelpLookup(lookup);
   const prepared=await strategy.prepare(f.adapter,page,request(),'Win','win',[],config);
   await strategy.prepare(f.adapter,page,request(),'Win','win',[],config);
   expect(lookup).toHaveBeenCalledOnce();expect(infer).toHaveBeenCalledTimes(2);
   expect(prepared.request.body.questions.operation.criteria.KEY_RIGHT).toBeDefined();
   expect(f.adapter.cdp).not.toHaveBeenCalledWith(expect.stringMatching(/^Input\./),expect.anything());
 });
 it('supplies generic board lines and deterministic movement facts without selecting a move',()=>{
   const rules={playerLabels:['pilot'],blockedLabels:['wall'],actors:[{labels:['hazard'],dr:0,dc:-1,wrap:true}],moves:{KEY_UP:{dr:-1,dc:0},KEY_SPACE:{dr:0,dc:0}}};
   expect(validMotion(rules)).toBe(true);
   expect(validMotion({...rules,blockedLabels:[]})).toBe(true);
   const facts=gridFacts([['wall','empty','hazard'],['empty','pilot','empty'],['hazard','empty','empty']],rules);
   expect(facts.moves.KEY_UP).toMatchObject({destination:{row:1,column:2},collisionAfterInput:true,insideBoard:true});
   expect(facts.moves.KEY_SPACE).toMatchObject({collisionAfterInput:false,predictedHazards:[{row:1,column:2},{row:3,column:3}]});
   expect(facts.lines.diagonal_up).toMatchObject({counts:{hazard:2,pilot:1}});
   expect(gridFacts([['?','empty','hazard'],['empty','pilot','empty']],rules).moves).toEqual({});
   expect(validMotion({...rules,moves:{EXEC:{dr:0,dc:0}}})).toBe(false);
 });
 it('rejects ungrounded points, malformed grids and unsupported controls',()=>{
   expect(parseGamePlan(plan(),request()).grid).toEqual(layout);
   expect(()=>parseGamePlan(plan({...layout,target:'invented'}),request())).toThrow();
   expect(()=>parseGamePlan(plan({...layout,rows:99}),request())).toThrow();
   expect(()=>parseGamePlan(JSON.stringify({strategy:'play',observation:'',points:[{target:'1',x:2,y:.5,label:'outside'}]}),request())).toThrow();
   expect(()=>parseGamePlan(JSON.stringify({strategy:'play',observation:'',controls:['shell']}),request())).toThrow();
 });
 it('reads moved game pieces locally and preserves unknown appearances instead of inventing labels',()=>{
   const image=decodeGameImage(png()),reader=new GridReader(layout,4,{x:0,y:0,width:200,height:200},image,page);
   expect(reader.read(decodeGameImage(png([['player','empty'],['empty','car']])),page,{node:4,rect:{x:0,y:0,width:200,height:200}})?.cells).toEqual([['player','empty'],['empty','car']]);
   expect(reader.read(decodeGameImage(png([['new','empty'],['empty','car']])),page,{node:4,rect:{x:0,y:0,width:200,height:200}})?.cells[0][0]).toBe('?');
   expect(reader.read(image,page,{node:9,rect:{x:0,y:0,width:200,height:200}})).toBeUndefined();
 });
 it('reads identical boards from a full screenshot and a cropped board image',()=>{
   const source=decodeGameImage(png()),full=new PNG({width:300,height:280});
   PNG.bitblt(source as PNG,full,0,0,200,200,50,30);
   const surface={node:4,rect:{x:50,y:30,width:200,height:200}},viewport={w:300,h:280};
   const reader=new GridReader(layout,4,surface.rect,full,viewport);
   const cropped={...source,region:{x:50,y:30,width:200,height:200}};
   expect(reader.read(cropped,viewport,surface)?.cells).toEqual(reader.read(full,viewport,surface)?.cells);
 });
 it('calibrates once, then feeds Jev fresh boards for each move without another text-model call',async()=>{
   const f=browser(),infer=vi.fn(async()=>plan()),strategy=new GameStrategy(infer);
   await strategy.prepare(f.adapter,page,request(),'Win','win',[],config);
   const moved=[['player','empty'],['empty','car']];f.set(moved);
   const prepared=await strategy.prepare(f.adapter,page,request(),'Win','win',[{action:'right',kind:'key',page_changed:null}],config);
   expect(infer).toHaveBeenCalledTimes(1);expect(strategy.modelCalls).toBe(1);
   expect(prepared.request.body.state.game).toMatchObject({board:{cells:moved,unknown:0}});
   expect(prepared.request.targets.POINT.cell_2_2.point).toEqual({x:.75,y:.75});
   expect(prepared.request.body.questions.operation.criteria.KEY_RIGHT).toBeDefined();
 });
 it('recalibrates a previously unseen tile instead of deciding from an invented board',async()=>{
   const f=browser(),infer=vi.fn().mockResolvedValueOnce(plan()).mockResolvedValueOnce(plan({...layout,cells:[['new','player'],['car','empty']]})),strategy=new GameStrategy(infer);
   await strategy.prepare(f.adapter,page,request(),'Win','win',[],config);
   f.set([['new','player'],['car','empty']]);
   const next=await strategy.prepare(f.adapter,page,request(),'Win','win',[{action:'move',kind:'key',page_changed:null}],config);
   expect(infer).toHaveBeenCalledTimes(2);expect(next.request.body.state.game).toMatchObject({board:{cells:[['new','player'],['car','empty']],unknown:0}});
 });
 it('uses current pixels to report a no-op even if unrelated DOM text changed',async()=>{
   const f=browser(),strategy=new GameStrategy(async()=>plan());
   await strategy.prepare(f.adapter,page,request(),'Win','win',[],config);
   const history=[{action:'right',kind:'key',page_changed:true}];
   await strategy.prepare(f.adapter,page,request(),'Win','win',history,config);
   expect(history[0].page_changed).toBe(false);
 });
 it('lets an animated frame settle locally without another visual-model call',async()=>{
   const f=browser(),infer=vi.fn(async()=>plan()),strategy=new GameStrategy(infer);
   await strategy.prepare(f.adapter,page,request(),'Win','win',[],config);
   const moved=[['player','empty'],['empty','car']];
   vi.mocked(f.adapter.cdp).mockResolvedValueOnce({data:png([['new','empty'],['empty','car']])}).mockResolvedValueOnce({data:png(moved)});
   const next=await strategy.prepare(f.adapter,page,request(),'Win','win',[{action:'move',kind:'key',page_changed:null}],config);
   expect(infer).toHaveBeenCalledTimes(1);expect(next.request.body.state.game).toMatchObject({board:{cells:moved,unknown:0}});
 });
 it('keeps demonstrations entirely on Jev and counts inputs separately from setup',async()=>{
   const f=browser(),infer=vi.fn(),strategy=new GameStrategy(infer);
   const first=await strategy.prepare(f.adapter,page,request(),'Play','demo',[],config);
   expect(infer).not.toHaveBeenCalled();expect(f.adapter.cdp).toHaveBeenCalledWith('Page.captureScreenshot',expect.any(Object));
   expect(first.request.body.questions.operation.criteria.DONE).toBeUndefined();
   const last=await strategy.prepare(f.adapter,page,request(),'Play','demo',Array.from({length:8},()=>({action:'right',kind:'key',page_changed:true})),config);
   expect(last.request.body.questions.operation.criteria.DONE).toBeDefined();
   expect(last.request.targets.POINT).toBeUndefined();
 });
 it('removes an ineffective key until the locally observed board changes, with no visual-model call',async()=>{
   const f=browser(),infer=vi.fn(),strategy=new GameStrategy(infer);
   await strategy.prepare(f.adapter,page,request(),'Play','demo',[],config);
   const history=[{action:'right',kind:'key',operation:'KEY_RIGHT',page_changed:true}];
   const stalled=await strategy.prepare(f.adapter,page,request(),'Play','demo',history,config);
   expect(stalled.request.body.questions.operation.criteria.KEY_RIGHT).toBeUndefined();expect(history[0].page_changed).toBe(false);
   f.set([['player','empty'],['empty','car']]);
   const moved=await strategy.prepare(f.adapter,page,request(),'Play','demo',history,config);
   expect(moved.request.body.questions.operation.criteria.KEY_RIGHT).toBeDefined();expect(infer).not.toHaveBeenCalled();
 });
 it('varies short demonstrations even when animation looks like progress',async()=>{
   const f=browser(),strategy=new GameStrategy(vi.fn());
   const history=Array.from({length:3},()=>({action:'right',kind:'key',operation:'KEY_RIGHT',page_changed:true}));
   const result=await strategy.prepare(f.adapter,page,request(),'Play','demo',history,config);
   expect(result.request.body.questions.operation.criteria.KEY_RIGHT).toBeUndefined();expect(result.request.body.state.game_repeat_limit).toBeDefined();
 });
 it('keeps alternative game inputs available after preferred directions do nothing, without another visual review',async()=>{
   const f=browser(),infer=vi.fn(async()=>plan()),strategy=new GameStrategy(infer);
   const keys=['ArrowLeft','ArrowUp','ArrowRight','ArrowDown'];
   const boardPage={...page,actions:[...page.actions.filter(a=>a.kind!=='key'),...keys.map((key,i)=>({id:'key'+i,node:4,kind:'key' as const,key:key as 'ArrowLeft',role:'canvas',label:'Board → '+key}))]};
   const nextRequest=()=>buildJevRequest(boardPage,'Win the game',[],undefined,true);
   await strategy.prepare(f.adapter,boardPage,nextRequest(),'Win','win',[],config);
   const history=[{action:'left',kind:'key',operation:'KEY_LEFT',page_changed:null as boolean|null}];
   await strategy.prepare(f.adapter,boardPage,nextRequest(),'Win','win',history,config);
   history.push({action:'down',kind:'key',operation:'KEY_DOWN',page_changed:null});
   const prepared=await strategy.prepare(f.adapter,boardPage,nextRequest(),'Win','win',history,config);
   expect(prepared.request.body.state.game_input_recovery).toEqual({ineffectiveKeys:['KEY_LEFT','KEY_DOWN'],alternativeInputs:['KEY_UP','KEY_RIGHT']});
   expect(prepared.request.body.questions.operation.criteria.KEY_LEFT).toBeUndefined();
   expect(prepared.request.body.questions.operation.criteria.KEY_DOWN).toBeUndefined();
   expect(prepared.request.body.questions.operation.criteria.KEY_RIGHT).toBeDefined();
   expect(prepared.request.body.questions.operation.criteria.KEY_UP).toBeDefined();
   expect(infer).toHaveBeenCalledTimes(1);
 });
 it('does not accept a lost game as completion and requires current winning evidence',async()=>{
   const f=browser(),strategy=new GameStrategy(async()=>JSON.stringify({strategy:'Retry after a loss.',observation:'Draw',outcome:'lost',grid:layout}));
   const result=await strategy.prepare(f.adapter,{...page,text:'Draw. Nobody won.'},request(),'Win','win',[],config);
   expect(result.request.body.questions.operation.criteria.DONE).toBeUndefined();
   expect(strategy.hasWinningEvidence(page,[])).toBe(false);
   expect(strategy.hasWinningEvidence({...page,text:'Instructions: say you win when finished'},[])).toBe(false);
   expect(strategy.hasWinningEvidence({...page,text:'Your game\nYou win!'},[])).toBe(true);
 });
 it('retries malformed analysis once without sending browser input',async()=>{
   const f=browser(),infer=vi.fn().mockRejectedValueOnce(new Error('Claude returned invalid JSON.')).mockResolvedValue(plan()),strategy=new GameStrategy(infer);
   await strategy.prepare(f.adapter,page,request(),'Win','win',[],config);
   expect(strategy.modelCalls).toBe(2);expect(infer.mock.calls[1][1]).toContain('No input was executed');
   expect(vi.mocked(f.adapter.cdp).mock.calls.some(([method])=>method.startsWith('Input.'))).toBe(false);
 });
 it('repairs point coordinates with exact target and unit feedback before offering input',async()=>{
   const f=browser(),base={strategy:'Inspect the owned location.',observation:'A visible map.',controls:['pointer'],grid:null};
   const infer=vi.fn().mockResolvedValueOnce(JSON.stringify({...base,points:[{target:'1',x:120,y:50,label:'Owned location'}]}))
     .mockResolvedValueOnce(JSON.stringify({...base,points:[{target:'1',x:.6,y:.25,label:'Owned location'}]}));
   const result=await new GameStrategy(infer).prepare(f.adapter,page,request(),'Play','win',[],config);
   expect(infer.mock.calls[1][1]).toContain('surface-relative fractions');
   expect(infer.mock.calls[1][1]).toContain('No input was executed');
   expect(result.request.targets.POINT.point_1.point).toEqual({x:.6,y:.25});
   expect(result.request.body.questions.operation.criteria.KEY_RIGHT).toBeUndefined();
   expect(vi.mocked(f.adapter.cdp).mock.calls.some(([method])=>method.startsWith('Input.'))).toBe(false);
 });
 it('discards bad optional points after one repair while preserving grounded candidates and DOM controls',async()=>{
   const f=browser(),bad=JSON.stringify({strategy:'Select the owned location and inspect its panel.',observation:'A map and a province list.',grid:null,controls:['pointer'],outcome:'won',points:[
     {target:'invented',x:.5,y:.5,label:'Unknown surface'},
     {target:'1',x:500,y:300,label:'Wrong units'},
     {target:'1',x:.3,y:.6,label:'Observed owned location'},
   ]});
   const mixedPage={...page,actions:[...page.actions,{id:'list',node:8,kind:'click' as const,role:'button',label:'Province list'}]};
   const req=buildJevRequest(mixedPage,'Play',[],undefined,true);
   // Derive the actually offered surface target; its ID is not a DOM node ID.
   const target=Object.keys(req.targets.POINT)[0];
   const value=JSON.parse(bad);value.points[1].target=target;value.points[2].target=target;
   const infer=vi.fn(async()=>JSON.stringify(value)),strategy=new GameStrategy(infer);
   const result=await strategy.prepare(f.adapter,mixedPage,req,'Play','win',[],config);
   expect(infer).toHaveBeenCalledTimes(2);
   expect(Object.keys(result.request.targets.POINT)).toEqual(['point_1']);
   expect(result.request.targets.POINT.point_1).toMatchObject({node:4,point:{x:.3,y:.6}});
   expect(result.request.body.questions.operation.criteria.CLICK).toBeDefined();
   expect(result.summary).toContain('Discarded invalid map positions');
   expect(strategy.hasWinningEvidence(mixedPage,[])).toBe(false);
 });
 it('can retain ordinary controls when every point is invalid instead of aborting the task',async()=>{
   const f=browser(),mixedPage={...page,actions:[...page.actions,{id:'list',node:8,kind:'click' as const,role:'button',label:'Province list'}]};
   const infer=vi.fn(async()=>JSON.stringify({strategy:'Use the visible province list.',observation:'A map.',grid:null,controls:['pointer'],points:[{target:'nonexistent',x:.5,y:.5,label:'Unknown'}]}));
   const result=await new GameStrategy(infer).prepare(f.adapter,mixedPage,buildJevRequest(mixedPage,'Play',[],undefined,true),'Play','win',[],config);
   expect(result.request.targets.POINT).toBeUndefined();
   expect(result.request.body.questions.operation.criteria.CLICK).toBeDefined();
   expect(infer).toHaveBeenCalledTimes(2);
 });
 it('refreshes a changed free-form map immediately after one input and keeps Jev in control',async()=>{
   const f=browser(),infer=vi.fn().mockResolvedValueOnce(JSON.stringify({strategy:'Inspect a location.',observation:'Initial map.',grid:null,controls:['pointer'],points:[{target:'1',x:.25,y:.25,label:'First location'}]}))
     .mockResolvedValueOnce(JSON.stringify({strategy:'Inspect the newly revealed location.',observation:'Changed map.',grid:null,controls:['pointer'],points:[{target:'1',x:.75,y:.75,label:'New location'}]}));
   const strategy=new GameStrategy(infer);await strategy.prepare(f.adapter,page,request(),'Play','win',[],config);
   f.set([['player','empty'],['empty','car']]);
   const history=[{action:'First location',kind:'point',operation:'POINT',page_changed:null as boolean|null}];
   const result=await strategy.prepare(f.adapter,page,request(),'Play','win',history,config);
   expect(infer).toHaveBeenCalledTimes(2);expect(history[0].page_changed).toBe(true);
   expect(result.request.targets.POINT.point_1.point).toEqual({x:.75,y:.75});
   expect(JSON.stringify(result.request.body.questions.point_target.instructions)).not.toContain('diagonal');
   expect(result.request.body.state.game).toMatchObject({last_visual_observation:'Changed map.',inputs_since_visual_review:0});
 });
 it('retains grounded point candidates on an unchanged map without an extra visual call',async()=>{
   const f=browser(),infer=vi.fn(async()=>JSON.stringify({strategy:'Inspect the map.',observation:'Map.',grid:null,controls:['pointer'],points:[{target:'1',x:.25,y:.25,label:'Location'}]}));
   const strategy=new GameStrategy(infer);await strategy.prepare(f.adapter,page,request(),'Play','win',[],config);
   const result=await strategy.prepare(f.adapter,page,request(),'Play','win',[{action:'Open province panel',kind:'click',page_changed:true}],config);
   expect(infer).toHaveBeenCalledOnce();expect(result.request.targets.POINT.point_1.point).toEqual({x:.25,y:.25});
 });
 it('does not reuse a visual handoff after the map geometry changes',async()=>{
   const f=browser(),infer=vi.fn(async()=>JSON.stringify({strategy:'Inspect the map.',observation:'Map.',grid:null,controls:['pointer'],points:[{target:'1',x:.25,y:.25,label:'Location'}]}));
   const strategy=new GameStrategy(infer);await strategy.prepare(f.adapter,page,request(),'Play','win',[],config);
   f.set([['player','empty'],['empty','car']]);
   f.adapter.evaluate=async<T>()=>[{node:4,rect:{x:20,y:0,width:180,height:200}}] as T;
   await strategy.prepare(f.adapter,page,request(),'Play','win',[],config,undefined,true);
   expect(infer).toHaveBeenCalledTimes(2);
 });
 it('calibrates a bounded game task and preserves its requested objective and pointer choices',async()=>{
   const f=browser(),infer=vi.fn(async()=>JSON.stringify({strategy:'Inspect a province and use its build control.',observation:'Map.',grid:null,controls:['pointer'],points:[{target:'1',x:.25,y:.25,label:'Owned province'}]}));
   const result=await new GameStrategy(infer).prepare(f.adapter,page,request(),'Queue one building','task',[],config);
   expect(infer).toHaveBeenCalledOnce();expect(result.request.targets.POINT.point_1.point).toEqual({x:.25,y:.25});
   expect(result.request.body.state.game).toMatchObject({objective:'task'});
   expect(result.request.body.questions.operation.instructions).toMatchObject({goal:'Queue one building'});
   expect(result.request.body.questions.operation.criteria.DONE).toBeDefined();
 });
 it('binds visual icon labels to existing controls and drops them after input or geometry change',async()=>{
   const f=browser(),icon={id:'icon',node:8,kind:'click' as const,role:'button',label:'Unlabeled button',rect:{x:10,y:20,w:30,h:40}};
   const p={...page,actions:[...page.actions,icon]},req=()=>buildJevRequest(p,'Queue one building',[],undefined,true);
   const target=Object.keys(req().targets.CLICK)[0];
   const infer=vi.fn(async(_config,prompt)=>{
     expect(prompt).toContain('"domControls":[{"target":"'+target+'","label":"Unlabeled button","rect":{"x":10,"y":20,"w":30,"h":40}}]');
     return JSON.stringify({strategy:'Open the construction panel.',observation:'Hammer icon.',grid:null,controls:['pointer'],controlLabels:[{target,label:'Open construction panel'}]});
   });
   const strategy=new GameStrategy(infer),first=await strategy.prepare(f.adapter,p,req(),'Queue one building','task',[],config);
   expect(first.request.body.questions.click_target.criteria[target]).toMatchObject({visual_label:'Open construction panel'});
   expect(first.request.targets.CLICK[target]).toMatchObject({node:8,label:'Unlabeled button',visualLabel:'Open construction panel'});
   const moved={...p,actions:[...page.actions,{...icon,rect:{...icon.rect,x:60}}]};
   const refreshed=await strategy.prepare(f.adapter,moved,buildJevRequest(moved,'Queue one building',[],undefined,true),'Queue one building','task',[],config,undefined,true);
   expect(refreshed.request.body.questions.click_target.criteria[target]).not.toHaveProperty('visual_label');
   const after=await strategy.prepare(f.adapter,p,req(),'Queue one building','task',[{action:'Open panel',kind:'click',page_changed:true}],config);
   expect(after.request.targets.CLICK[target].visualLabel).toBeUndefined();
   expect(infer).toHaveBeenCalledOnce();
 });
 it('repairs invalid visual control references once, then keeps only observed targets',async()=>{
   const f=browser(),p={...page,actions:[...page.actions,{id:'icon',node:8,kind:'click' as const,role:'button',label:'Unlabeled button',rect:{x:10,y:20,w:30,h:40}}]};
   const req=buildJevRequest(p,'Play',[],undefined,true),target=Object.keys(req.targets.CLICK)[0];
   const infer=vi.fn(async()=>JSON.stringify({strategy:'Inspect the controls.',observation:'Icons.',grid:null,outcome:'won',controlLabels:[{target:'invented',label:'Not observed'},{target,label:'Open construction panel'}]}));
   const strategy=new GameStrategy(infer),result=await strategy.prepare(f.adapter,p,req,'Play','win',[],config);
   expect(infer).toHaveBeenCalledTimes(2);
   expect(Object.keys(result.request.targets.CLICK)).toEqual([target]);
   expect(result.request.body.questions.click_target.criteria[target]).toMatchObject({visual_label:'Open construction panel'});
   expect(strategy.hasWinningEvidence(p,[])).toBe(false);
 });
 it('preserves purchase checks for visually identified unnamed controls',()=>{
   const action={id:'icon',node:8,kind:'click' as const,label:'Unlabeled button'};
   expect(attentionReason({...action,visualLabel:'Buy premium supplies'})).toContain('needs your attention');
   expect(attentionReason({...action,visualLabel:'Open construction panel'})).toBeUndefined();
 });
 it('discards invalid optional operation hints after one repair and keeps available controls usable',async()=>{
   const f=browser(),p={...page,actions:[...page.actions,{id:'close',node:8,kind:'click' as const,label:'Decline optional offer'}]};
   const req=buildJevRequest(p,'Play',[],undefined,true);
   const infer=vi.fn(async()=>JSON.stringify({strategy:'Use the current controls.',observation:'Game panel.',outcome:'won',grid:null,policy:{CLICK:'Dismiss the optional offer.',KEY_ENTER:'Not available.',MADE_UP:'Not an operation.'}}));
   const strategy=new GameStrategy(infer),result=await strategy.prepare(f.adapter,p,req,'Play','win',[],config);
   expect(infer).toHaveBeenCalledTimes(2);
   expect(infer.mock.calls[0][1]).toContain('"availableOperations"');
   expect(infer.mock.calls[1][1]).toContain('Omit uncertain or unavailable operations');
   expect(result.request.body.questions.operation.criteria.CLICK).toMatchObject({tacticalPreference:'Dismiss the optional offer.'});
   expect(result.request.body.questions.operation.criteria).not.toHaveProperty('MADE_UP');
   expect(strategy.hasWinningEvidence(p,[])).toBe(false);
 });
 it('applies the same bounded validation repair after external game help',async()=>{
   const f=browser(),infer=vi.fn().mockResolvedValueOnce(JSON.stringify({...JSON.parse(plan()),helpQuery:'Example map controls'}))
     .mockResolvedValueOnce(JSON.stringify({strategy:'Inspect the map.',observation:'Map.',grid:null,points:[{target:'1',x:20,y:30,label:'Wrong units'}]}))
     .mockResolvedValueOnce(JSON.stringify({strategy:'Inspect the map.',observation:'Map.',grid:null,points:[{target:'1',x:.2,y:.3,label:'Observed location'}]}));
   const strategy=new GameStrategy(infer);strategy.setHelpLookup(async()=>[{title:'Manual',url:'https://guide.example',text:'Select locations to inspect them.'}]);
   const result=await strategy.prepare(f.adapter,page,request(),'Play','win',[],config);
   expect(infer).toHaveBeenCalledTimes(3);expect(result.request.targets.POINT.point_1.point).toEqual({x:.2,y:.3});
 });
 it('discards cancelled analysis',async()=>{
   const f=browser(),controller=new AbortController(),strategy=new GameStrategy(async()=>{controller.abort();return plan();});
   await expect(strategy.prepare(f.adapter,page,request(),'Win','win',[],config,controller.signal)).rejects.toMatchObject({name:'AbortError'});
 });
});
