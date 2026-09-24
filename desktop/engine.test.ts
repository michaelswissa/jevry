import { describe, it, expect, vi } from 'vitest';
import {
  AgentEngine, attentionReason, buildActionSpace, buildJevRequest, jevEndpoint, selectDecision,
  validateChoice, type AgentEvent, type BrowserAdapter, type JevRequest, type JevResponse,
  type ObservedAction, type PageState,
} from './engine';
import { READ_STATE } from './snapshot';
import { GameStrategy } from './game-strategy';
import { numericOcr } from './numeric-ocr';

const click: ObservedAction = { id: 'e1', node: 1, kind: 'click', label: 'Search', role: 'button' };
const fill: ObservedAction = { id: 'e2', node: 2, kind: 'fill', label: 'Destination', role: 'textbox', value: '' };
function page(actions: ObservedAction[] = [click, fill], revision = 1): PageState {
  return {
    url: 'https://example.com', title: 'Fixture', text: 'Find your destination', w: 1200, h: 800,
    actions, marker: [revision], page_key: [revision], guards: { '1': ['Search'], '2': ['Destination'] },
  };
}
function answer(choices: string[], selected: string) {
  return { choice: selected, confidence: 1, probabilities: Object.fromEntries(choices.map(choice => [choice, choice === selected ? 1 : 0])) };
}
const actionQuestion = (body:JevRequest) => body.questions.web_action || body.questions.operation;
function operationCriteria(body:JevRequest):Record<string,unknown> {
  return body.questions.web_action ? Object.fromEntries(Object.values(body.questions.web_action.criteria).map(raw=>{
    const value=raw as {operation:string;description?:unknown};return [value.operation,value.description??value.operation];
  })) : body.questions.operation.criteria;
}
function targetCriteria(body:JevRequest,operation:string):Record<string,unknown> {
  return body.questions.web_action ? Object.fromEntries(Object.values(body.questions.web_action.criteria).flatMap(raw=>{
    const value=raw as {operation:string;target?:string};return value.operation===operation&&value.target?[[value.target,raw]]:[];
  })) : body.questions[operation.toLowerCase()+'_target']?.criteria||{};
}
function response(body: JevRequest, operation: string, target?: string): JevResponse {
  const joint=body.questions.web_action;
  const selected=joint?Object.entries(joint.criteria).find(([,raw])=>{const value=raw as {operation:string;target?:string};return value.operation===operation&&(value.target===undefined||value.target===target);})?.[0]:undefined;
  const answers: JevResponse['answers'] = joint?{web_action:answer(Object.keys(joint.criteria),selected||operation+':'+target)}:{ operation: answer(Object.keys(body.questions.operation.criteria), operation) };
  for(const [id,q]of Object.entries(body.questions))if(id.startsWith('fill_value_'))answers[id]=answer(Object.keys(q.criteria),'NONE');
  if (target) {
    const key = `${operation.toLowerCase()}_target`;
    if (body.questions[key]) answers[key] = answer(Object.keys(body.questions[key].criteria), target);
  }
  return { model: 'jev-fixture', answers };
}
class FakeBrowser implements BrowserAdapter {
  state = page();
  scripts: string[] = [];
  commands: Array<{ method: string; params?: Record<string, unknown> }> = [];
  staleTargets = 0;
  focus = true;
  failObserveAfterClick = false;
  observationFailures = 0;
  async evaluate<T>(expression: string): Promise<T> {
    this.scripts.push(expression);
    if (expression.startsWith('/* jev:fresh */')) return structuredClone(this.state.marker) as T;
    if (expression.startsWith('/* jev:target */')) {
      if (this.staleTargets-- > 0) return { stale: true } as T;
      return { x: 30, y: 20 } as T;
    }
    if (expression.startsWith('/* jev:focused */')) return this.focus as T;
    if (expression.startsWith('/* jev:settle */')) return true as T;
    if (expression === READ_STATE) {
      if (this.failObserveAfterClick && this.commands.some(command => command.params?.type === 'mouseReleased')) {
        this.observationFailures++;
        throw new Error('navigating');
      }
      return structuredClone(this.state) as T;
    }
    throw new Error('Unexpected script');
  }
  async cdp(method: string, params?: Record<string, unknown>) { this.commands.push({ method, params }); return {}; }
  url() { return this.state.url; }
  async navigate(url: string) { this.state.url = url; }
}
const config = { goal: 'Find flights to London', textConfig: { provider: 'openai' as const }, jevConfig: { apiKey: 'test' } };

it('uses a complete web-action choice for native input and preserves the actual head confidence',async()=>{
  const browser=new FakeBrowser(),events:AgentEvent[]=[];let calls=0;
  const result=await new AgentEngine(browser,event=>events.push(event),{infer:async(_,body)=>{
    expect(body.questions.operation).toBeUndefined();expect(body.questions.click_target).toBeUndefined();
    expect(body.questions.web_action.criteria['CLICK:1']).toMatchObject({operation:'CLICK',target:'1',element:'[1] Search'});
    const result=response(body,calls++?'DONE':'CLICK','1');result.answers.web_action.confidence=.72;
    result.answers.operation={choice:'invented',confidence:NaN,probabilities:{}};
    return result;
  }}).run(config);
  expect(result).toMatchObject({status:'complete',steps:1});
  expect(events.filter(event=>event.type==='decision').map(event=>event.confidence)).toEqual([.72,.72]);
  expect(browser.commands.filter(command=>command.params?.type==='mousePressed')).toHaveLength(1);
});

it('rejects an unoffered complete action before dispatching input',async()=>{
  const browser=new FakeBrowser();
  const result=await new AgentEngine(browser,()=>{},{infer:async(_,body)=>{
    const result=response(body,'CLICK','1');result.answers.web_action.choice='CLICK:999';return result;
  }}).run(config);
  expect(result).toMatchObject({status:'error',steps:0});
  expect(browser.commands.some(command=>command.method.startsWith('Input.'))).toBe(false);
});

it('retains the original fan-out when complete web actions exceed the choice budget',async()=>{
  const browser=new FakeBrowser();browser.state=page(Array.from({length:239},(_,i)=>({...click,id:'e'+(i+1),node:i+1,label:'Observed '+i})));
  const infer=vi.fn(async(_,body:JevRequest)=>{expect(body.questions.web_action).toBeUndefined();expect(body.questions.operation).toBeDefined();return response(body,'BLOCKED');});
  expect(await new AgentEngine(browser,()=>{},{infer}).run(config)).toMatchObject({status:'blocked',steps:0});
  expect(infer).toHaveBeenCalledOnce();
});

it('detects a repeating two-state menu cycle and reviews it before exhausting the action budget',async()=>{
  const browser=new FakeBrowser();let clicks=0;
  browser.cdp=async(method,params)=>{browser.commands.push({method,params});if(params?.type==='mouseReleased'){clicks++;browser.state=page([click],clicks%2);}};
  const recoverTask=vi.fn(async()=>({canProgress:true,strategy:'The result is already present. Read it instead of toggling the menu.'}));
  const result=await new AgentEngine(browser,()=>{},{recoverTask,infer:async(_,body)=>response(body,body.state.recoveryStrategy?'DONE':'CLICK','1')}).run(config);
  expect(result).toMatchObject({status:'complete',steps:6});expect(recoverTask).toHaveBeenCalledOnce();
});

it('recognizes repeated reloads of the same visible result despite fresh document and node identities',async()=>{
  const browser=new FakeBrowser();let clicks=0;
  browser.cdp=async(method,params)=>{if(params?.type==='mouseReleased'){clicks++;browser.state=page([{...click,node:clicks+1}],clicks+1);}return {};};
  const recoverTask=vi.fn(async()=>({canProgress:true,strategy:'Read the report; reloading it has not changed the result.'}));
  const result=await new AgentEngine(browser,()=>{},{recoverTask,infer:async(_,body)=>response(body,body.state.recoveryStrategy?'DONE':'CLICK','1')}).run(config);
  expect(result).toMatchObject({status:'complete',steps:6});expect(recoverTask).toHaveBeenCalledOnce();
});

it('detects a click and native Back cycle and reviews it before spending the remaining action budget',async()=>{
 const browser=new FakeBrowser();let currentIndex=0,revision=1;
 const entries=[{id:10,url:'https://example.com/list'},{id:11,url:'https://example.com/unrelated'}];
 const show=()=>{browser.state={...page(currentIndex?[]:[{...click,href:entries[1].url}],revision++),url:entries[currentIndex].url,text:currentIndex?'Unrelated page':'Original listing'};};show();
 browser.cdp=async(method,params)=>{
   browser.commands.push({method,params});
   if(method==='Page.getNavigationHistory')return {currentIndex,entries};
   if(method==='Page.navigateToHistoryEntry'){currentIndex=0;show();}
   if(params?.type==='mouseReleased'){currentIndex=1;show();}
   return {};
 };
 const recoverTask=vi.fn(async()=>({canProgress:true,strategy:'Use the already observed result.'}));
 const result=await new AgentEngine(browser,()=>{},{recoverTask,infer:async(_,body)=>response(body,body.state.recoveryStrategy?'DONE':currentIndex?'GO_BACK':'CLICK',!body.state.recoveryStrategy&&!currentIndex?'1':undefined)}).run({...config,maxSteps:12});
 expect(result).toMatchObject({status:'complete',steps:6});expect(recoverTask).toHaveBeenCalledOnce();
 expect(browser.commands.filter(c=>c.method==='Page.navigateToHistoryEntry')).toHaveLength(3);
});

it('interrupts alternating dropdown values instead of treating each change as lasting progress',async()=>{
 const browser=new FakeBrowser();let selections=0;
 const show=()=>{const current=selections%2?'Year':'Day';browser.state={...page([{id:'period',kind:'select',node:1,label:'Period → '+(current==='Day'?'Year':'Day'),current_value:current,value:current==='Day'?'year':'day'}],selections+1),text:'Report results unchanged'};};show();
 const evaluate=browser.evaluate.bind(browser);
 browser.evaluate=async<T>(expression:string)=>{if(expression.startsWith('/* jev:target */')){selections++;show();return {x:30,y:20} as T;}return evaluate<T>(expression);};
 const recoverTask=vi.fn(async()=>({canProgress:true,strategy:'Read the unchanged results instead of toggling the same setting.'}));
 const result=await new AgentEngine(browser,()=>{},{recoverTask,infer:async(_,body)=>response(body,body.state.recoveryStrategy?'DONE':'SELECT',body.state.recoveryStrategy?undefined:'1:1')}).run({...config,maxSteps:60});
 expect(result).toMatchObject({status:'complete',steps:6});expect(selections).toBe(6);expect(recoverTask).toHaveBeenCalledOnce();
});

describe('task success conditions across ordinary websites',()=>{
  const contract={success:['Results include London.','The two-traveler filter is selected.'],constraints:['Two travelers'],progressOnly:['Clicking Search']};
  function assessment(body:JevRequest,observed:boolean):JevResponse {
    const evidence=body.state.untrustedEvidence as Record<string,string>;
    return {answers:{...Object.fromEntries(Object.entries(body.questions).filter(([id])=>id.startsWith('criterion_')).map(([id,q])=>[id,answer(Object.keys(q.criteria),observed?Object.keys(q.criteria).find(key=>key!=='NOT_OBSERVED'&&evidence[key]?.includes('London results'))!:'NOT_OBSERVED')])),coverage:answer(['COMPLETE','INCOMPLETE'],observed?'COMPLETE':'INCOMPLETE')}};
  }
  it('rejects premature DONE, keeps acting, then cites evidence for every condition without independently verifying it',async()=>{
    const browser=new FakeBrowser();let moved=false;
    const dispatch=browser.cdp.bind(browser);
    browser.cdp=async(method,params)=>{const result=await dispatch(method,params);if(params?.type==='mouseReleased'){moved=true;browser.state={...page([click],2),text:'London results. Two-traveler filter selected.'};}return result;};
    let decisions=0;
    const infer=vi.fn(async(_config,body:JevRequest)=>{
      if(!actionQuestion(body))return assessment(body,moved);
      expect(body.state.taskContract).toEqual(contract);
      if(decisions++===1){expect(body.state.unconfirmedConditions).toBeDefined();return response(body,'CLICK','1');}
      expect(body.questions.criterion_0).toBeUndefined();
      return response(body,'DONE');
    });
    const result=await new AgentEngine(browser,()=>{},{infer}).run({...config,contract});
    expect(result).toMatchObject({status:'complete',steps:1,verified:false,completionEvidence:contract.success.map(condition=>({condition,evidence:'London results. Two-traveler filter selected.'}))});
    expect(infer).toHaveBeenCalledTimes(5); // Only DONE incurs a citation check.
  });
  it('never treats an invented evidence reference as completion',async()=>{
    const browser=new FakeBrowser();
    const infer=vi.fn(async(_config,body:JevRequest)=>actionQuestion(body)?response(body,'DONE'):{answers:{criterion_0:answer(['invented'],'invented')}});
    const result=await new AgentEngine(browser,()=>{},{infer}).run({...config,contract});
    expect(result).toMatchObject({status:'error',steps:0,verified:false});
    expect(result.completionEvidence).toBeUndefined();
  });
  it('keeps acting when citations match but the requested set is incomplete',async()=>{
    const browser=new FakeBrowser();browser.state.text='London results. Two-traveler filter selected.';
    const dispatch=browser.cdp.bind(browser);let moved=false,decisions=0;
    browser.cdp=async(method,params)=>{const result=await dispatch(method,params);if(params?.type==='mouseReleased'){moved=true;browser.state={...page([click],2),text:'London results. Two-traveler filter selected. All relevant results read.'};}return result;};
    const infer=vi.fn(async(_config,body:JevRequest)=>{
      if(!actionQuestion(body))return {answers:{...assessment(body,true).answers,coverage:answer(['COMPLETE','INCOMPLETE'],moved?'COMPLETE':'INCOMPLETE')}};
      if(decisions++===1){
        expect(body.state.unconfirmedConditions).toBeDefined();
        expect(operationCriteria(body)).not.toHaveProperty('DONE');
        return response(body,'CLICK','1');
      }
      return response(body,'DONE');
    });
    const result=await new AgentEngine(browser,()=>{},{infer}).run({...config,contract});
    expect(result).toMatchObject({status:'complete',steps:1,verified:false});
    expect(infer).toHaveBeenCalledTimes(5);
  });
  it('discards evidence when the page changes during the final check',async()=>{
    const browser=new FakeBrowser();browser.state.text='London results. Two-traveler filter selected.';
    let checks=0;
    const infer=vi.fn(async(_config,body:JevRequest)=>{
      if(actionQuestion(body))return response(body,'DONE' in operationCriteria(body)?'DONE':'BLOCKED');
      const observed=checks++===0;
      if(observed)browser.state={...page([click],2),text:'Loading another page'};
      return assessment(body,observed);
    });
    const result=await new AgentEngine(browser,()=>{},{infer}).run({...config,contract});
    expect(result).toMatchObject({status:'blocked',steps:0,verified:false});
    expect(result.completionEvidence).toBeUndefined();
  });
});

describe('bounded task reasoning when Jev requests help',()=>{
  it('uses a revised approach with fresh state while keeping Jev in charge of native actions',async()=>{
    const browser=new FakeBrowser(),recoverTask=vi.fn(async()=>({canProgress:true,strategy:'The results are behind the Search button; use it before checking completion.',nextGoal:'Read the available London results.'}));
    let decisions=0;
    const infer=vi.fn(async(_config,body:JevRequest)=>{
      if(decisions++===0)return response(body,'BLOCKED');
      expect(body.state.recoveryStrategy).toMatchObject({advice:expect.stringContaining('Search button')});
      expect(actionQuestion(body).instructions).toMatchObject({goal:'Read the available London results.'});
      expect(body.state.originalUserGoal).toBe(config.goal);
      return response(body,decisions===2?'CLICK':'DONE',decisions===2?'1':undefined);
    });
    const result=await new AgentEngine(browser,()=>{},{infer,recoverTask}).run(config);
    expect(result).toMatchObject({status:'complete',steps:1});expect(recoverTask).toHaveBeenCalledOnce();
    expect(browser.commands.filter(c=>c.params?.type==='mousePressed')).toHaveLength(1);
  });
  it('bounds repeated reviews and never bypasses a sensitive native control',async()=>{
    const browser=new FakeBrowser(),recoverTask=vi.fn(async()=>({canProgress:true,strategy:'Inspect another offered control.'}));
    const infer=vi.fn(async(_config,body:JevRequest)=>response(body,'BLOCKED'));
    const result=await new AgentEngine(browser,()=>{},{infer,recoverTask}).run(config);
    expect(result).toMatchObject({status:'blocked',steps:0});expect(recoverTask).toHaveBeenCalledTimes(2);
    browser.state=page([{...click,label:'Send message'}]);
    const unsafe=await new AgentEngine(browser,()=>{},{infer:async(_config,body)=>response(body,'CLICK','1'),recoverTask}).run(config);
    expect(unsafe.status).toBe('blocked');expect(recoverTask).toHaveBeenCalledTimes(2);
    expect(browser.commands.some(c=>c.method.startsWith('Input.'))).toBe(false);
  });
});

describe('verification challenge gate', () => {
  it('stops before inference and input when verification needs the user', async () => {
    const browser = new FakeBrowser(), infer = vi.fn();
    const result = await new AgentEngine(browser, () => {}, {
      infer, beforeStep: async () => ({ handled: false, blocked: 'Complete verification in this page, then continue.' }),
    }).run(config);
    expect(result).toMatchObject({ status: 'blocked', steps: 0, modelCalls: 0, verified: false });
    expect(infer).not.toHaveBeenCalled();
    expect(browser.commands.some(command => command.method.startsWith('Input.'))).toBe(false);
  });

  it('discards pre-challenge observations before choosing an action', async () => {
    const browser = new FakeBrowser();
    const infer = vi.fn(async (_config, body: JevRequest) => {
      expect(body.state.page).toMatchObject({ text: 'Verified page after navigation' });
      return response(body, 'DONE');
    });
    const result = await new AgentEngine(browser, () => {}, {
      infer, beforeStep: async () => {
        browser.state = { ...page([], 2), text: 'Verified page after navigation' };
        return { handled: true };
      },
    }).run(config);
    expect(result.status).toBe('complete');
    expect(infer).toHaveBeenCalledTimes(1);
    expect(result.page?.text).toBe('Verified page after navigation');
  });

  it('does not resume normal actions after cancellation during verification', async () => {
    const browser = new FakeBrowser(), controller = new AbortController(), infer = vi.fn();
    const result = await new AgentEngine(browser, () => {}, {
      infer, beforeStep: async () => { controller.abort(); return { handled: true }; },
    }).run({ ...config, signal: controller.signal });
    expect(result.status).toBe('stopped');
    expect(infer).not.toHaveBeenCalled();
    expect(browser.commands.some(command => command.method.startsWith('Input.'))).toBe(false);
  });
});

describe('ordinary task navigation and authorization',()=>{
  it('annotates actual returned destinations without inflating visits on repeated observations or hiding reinspection',async()=>{
    const a='https://example.com/list',b='https://example.com/details',c='https://example.com/unread';
    const links=[{...click,href:b,label:'Details'},{...click,id:'e3',node:3,href:c,label:'Unread'}];
    const browser=new FakeBrowser();browser.state={...page(links),url:a};
    let index=0,revision=1,calls=0;
    const entries=[{id:10,url:a,title:'List'},{id:20,url:b,title:'Details'}];
    browser.cdp=async(method,params)=>{
      browser.commands.push({method,params});
      if(method==='Page.getNavigationHistory')return {currentIndex:index,entries:entries.slice(0,index+1)};
      if(params?.type==='mouseReleased'){index=1;browser.state={...page(links,++revision),url:b};}
      if(method==='Page.navigateToHistoryEntry'){index=0;browser.state={...page(links,++revision),url:a};}
      return {};
    };
    const result=await new AgentEngine(browser,()=>{},{beforeStep:async()=>({handled:true}),infer:async(_,body)=>{
      const details=Object.values(targetCriteria(body,'CLICK')).find(value=>(value as {href?:string}).href===b) as Record<string,unknown>;
      const unread=Object.values(targetCriteria(body,'CLICK')).find(value=>(value as {href?:string}).href===c) as Record<string,unknown>;
      expect(unread).not.toHaveProperty('prior_observation');
      if(calls++===0){expect(details).not.toHaveProperty('prior_observation');return response(body,'CLICK','1');}
      if(calls===2){expect(details.prior_observation).toEqual({last_observed_step:1,visit_count:1});return response(body,'GO_BACK');}
      if(calls===3){expect(details.prior_observation).toEqual({last_observed_step:1,visit_count:1});return response(body,'CLICK','1');}
      expect(details.prior_observation).toEqual({last_observed_step:3,visit_count:2});
      return response(body,'DONE');
    }}).run(config);
    expect(result).toMatchObject({status:'complete',steps:3,modelCalls:4});
    expect(browser.commands.filter(command=>command.params?.type==='mousePressed')).toHaveLength(2);
    expect(JSON.stringify(result.observations)).not.toContain('prior_observation');
  });

  it('does not count an attempted link as observed or carry destination hints across turns',async()=>{
    const destination='https://example.com/details',browser=new FakeBrowser();
    browser.state=page([{...click,href:destination}]);
    let calls=0,turn=0;
    const engine=new AgentEngine(browser,()=>{},{infer:async(_,body)=>{
      if(turn===1)expect(body.questions.web_action.criteria['CLICK:1']).toMatchObject({prior_observation:{last_observed_step:0,visit_count:1}});
      else expect(body.questions.web_action.criteria['CLICK:1']).not.toHaveProperty('prior_observation');
      return response(body,turn===0&&calls++===0?'CLICK':'DONE','1');
    }});
    expect(await engine.run(config)).toMatchObject({status:'complete',steps:1,modelCalls:2});
    // Observe the destination in a separate turn, then return to a new turn on
    // the original page. Neither earlier turn may seed this turn's index.
    browser.state={...browser.state,url:destination};
    turn=1;
    expect(await engine.run(config)).toMatchObject({status:'complete',steps:0,modelCalls:1});
    browser.state={...browser.state,url:'https://example.com'};
    turn=2;
    expect(await engine.run(config)).toMatchObject({status:'complete',steps:0,modelCalls:1});
  });

  it('leaves game requests without ordinary destination hints',async()=>{
    const browser=new FakeBrowser();browser.state=page([{...click,href:'https://example.com'}]);
    const gameStrategy={beginRun:vi.fn(),progress:()=>undefined,prepare:async()=>({}),modelCalls:0} as unknown as GameStrategy;
    const result=await new AgentEngine(browser,()=>{},{gameStrategy,infer:async(_,body)=>{
      expect(JSON.stringify(body)).not.toContain('prior_observation');
      expect(body.state.destinationObservationPolicy).toBeUndefined();
      return response(body,'BLOCKED');
    }}).run({...config,gameMode:'demo'});
    expect(result).toMatchObject({status:'blocked',steps:0,modelCalls:1});
  });

  it('passes rejected navigation as app feedback, excludes only the rejected GET link, and preserves website evidence',async()=>{
    const rejected={...click,href:'https://example.com/redirect?report=1',label:'External report'};
    const local={...click,id:'local',node:2,href:'https://example.com/local',label:'Local report'};
    const variant={...click,id:'variant',node:3,href:'https://example.com/redirect?report=2',label:'Another report'};
    const dynamic={...click,id:'dynamic',node:4,label:'Dynamic popup'};
    const post={...click,id:'post',node:5,href:'https://example.com/redirect?report=1',label:'Form control',form_method:'post'};
    let inputs=0;
    const feedback=[{kind:'origin_rejected' as const,phase:'redirect' as const,origin:'https://outside.test',reason:'outside_allowed_sites' as const}];
    const browser=Object.assign(new FakeBrowser(),{
      navigationFeedback:()=>inputs?feedback:[],
      isRejectedNavigation:(source:string,href:string)=>inputs>0&&source==='https://example.com'&&href==='https://example.com/redirect?report=1',
    });
    browser.state=page([rejected,local,variant,dynamic,post]);
    browser.cdp=async(method,params)=>{browser.commands.push({method,params});if(params?.type==='mouseReleased')inputs++;return {};};
    const result=await new AgentEngine(browser,()=>{},{infer:async(_,body)=>{
      if(!inputs){expect(body.state.navigationFeedback).toBeUndefined();return response(body,'CLICK','1');}
      expect(body.state.navigationFeedback).toMatchObject({outcomes:feedback});
      expect(body.state.page).toMatchObject({text:'Find your destination'});
      expect(JSON.stringify(body.state.observations)).not.toContain('origin_rejected');
      const elements=body.state.elements as Array<{label:string;index:string}>;
      expect(elements.map(e=>e.label)).toEqual(['Local report','Another report','Dynamic popup','Form control']);
      return response(body,inputs===1?'CLICK':'DONE',elements.find(e=>e.label==='Local report')!.index);
    }}).run(config);
    expect(result).toMatchObject({status:'complete',steps:2});
    expect(result.observations?.every(item=>!JSON.stringify(item).includes('origin_rejected'))).toBe(true);
    expect(browser.commands.filter(command=>command.params?.type==='mousePressed')).toHaveLength(2);
  });

  it('omits outbound and invalid links when the user supplied a site boundary',async()=>{
    const browser=new FakeBrowser();browser.state=page([
      {...click,href:'/local'}, {...click,id:'e3',node:3,href:'https://outside.test/'},
      {...click,id:'e4',node:4,href:'http://['},
    ]);
    const contract={success:['Read the page'],constraints:[],progressOnly:[],allowedOrigins:['https://example.com']};
    await new AgentEngine(browser,()=>{},{infer:async(_,body)=>{
      expect(body.state.elements).toEqual([expect.objectContaining({href:'/local'})]);
      return response(body,'BLOCKED');
    }}).run({...config,contract});
    expect(browser.commands.some(c=>c.method.startsWith('Input.'))).toBe(false);
  });
  it('permits an explicitly requested ordinary save while preserving other boundaries',()=>{
    const save:ObservedAction={...click,label:'Save profile',input_type:'submit',form_method:'post',context:'Biography'};
    const contract={success:['Profile saved'],constraints:[],progressOnly:[],allowFormSubmission:true};
    expect(attentionReason(save)).toMatch(/Review/);
    expect(attentionReason(save,contract)).toBeUndefined();
    expect(attentionReason({...save,label:'Send message'},contract)).toMatch(/attention/);
    expect(attentionReason({...save,context:'Change password and account security'},contract)).toMatch(/manually/);
  });
  it('offers Back only for navigation created during this task and checks history before dispatch',async()=>{
    const browser=new FakeBrowser();let index=1,decisions=0;
    const entries=[{id:10,url:'https://private.test/'},{id:20,url:'https://example.com',title:'Starting page'},{id:30,url:'https://example.com/details'}];
    browser.cdp=async(method,params)=>{
      browser.commands.push({method,params});
      if(method==='Page.getNavigationHistory')return {currentIndex:index,entries:entries.slice(0,index+1)};
      if(params?.type==='mouseReleased'){index=2;browser.state=page([click],2);browser.state.url=entries[2].url;}
      if(method==='Page.navigateToHistoryEntry'){expect(params).toEqual({entryId:20});index=1;browser.state=page([click],3);}
      return {};
    };
    const result=await new AgentEngine(browser,()=>{},{infer:async(_,body)=>{
      const operations=operationCriteria(body);
      if(decisions++===0){expect(operations).not.toHaveProperty('GO_BACK');return response(body,'CLICK','1');}
      if(decisions===2){expect(operations.GO_BACK).toContain('Starting page');return response(body,'GO_BACK');}
      expect(operations).not.toHaveProperty('GO_BACK');return response(body,'DONE');
    }}).run(config);
    expect(result).toMatchObject({status:'complete',steps:2});
    expect(browser.commands.filter(c=>c.method==='Page.navigateToHistoryEntry')).toHaveLength(1);
  });
  it('does not dispatch a stale Back choice or replay an interrupted navigation',async()=>{
    for(const stale of [true,false]) {
      const browser=new FakeBrowser();let index=0,decisions=0;
      const entries=[{id:20,url:'https://example.com'},{id:30,url:'https://example.com/details'}];
      browser.cdp=async(method,params)=>{
        browser.commands.push({method,params});
        if(method==='Page.getNavigationHistory')return {currentIndex:index,entries};
        if(params?.type==='mouseReleased'){index=1;browser.state=page([click],2);}
        if(method==='Page.navigateToHistoryEntry')throw new Error('Disconnected after send');
        return {};
      };
      const result=await new AgentEngine(browser,()=>{},{infer:async(_,body)=>{
        if(decisions++===0)return response(body,'CLICK','1');
        if(decisions===2){if(stale)index=0;return response(body,'GO_BACK');}
        return response(body,'BLOCKED');
      }}).run(config);
      expect(result.status).toBe(stale?'blocked':'error');
      expect(result.steps).toBe(1);
      expect(browser.commands.filter(c=>c.method==='Page.navigateToHistoryEntry')).toHaveLength(stale?0:1);
    }
  });
});

describe('Jev protocol', () => {
  it('uses the upstream TypeSafe endpoint, not an OpenAI chat endpoint', () => {
    expect(jevEndpoint()).toBe('https://api.typesafe.ai/v1/systemone');
    expect(jevEndpoint('https://api.typesafe.ai')).toBe('https://api.typesafe.ai/v1/systemone');
    expect(jevEndpoint('https://api.typesafe.ai/v1/systemone')).toBe('https://api.typesafe.ai/v1/systemone');
    expect(() => jevEndpoint('http://remote.example')).toThrow(/HTTPS/);
    expect(() => jevEndpoint('https://user:password@remote.example')).toThrow(/clean/);
  });

  it('indexes one DOM node once and keeps operation-specific dropdown choices', () => {
    const space = buildActionSpace([
      fill, { ...fill, id: 'e3', kind: 'click', label: 'Open Destination' },
      { id: 'e4', node: 3, kind: 'select', label: 'Cabin → Economy', value: 'eco' },
      { id: 'e5', node: 3, kind: 'select', label: 'Cabin → Business', value: 'biz' },
    ]);
    expect(space.elements).toHaveLength(2);
    expect(space.targets.TYPE_TEXT['1']).toEqual(fill);
    expect(space.targets.CLICK['1'].kind).toBe('click');
    expect(space.targets.SELECT['2:2'].value).toBe('biz');
  });

  it('selects across more than 255 options with one speculative request, ignoring unselected heads',()=>{
    const actions=Array.from({length:450},(_,i):ObservedAction=>({id:'option_'+i,node:1,kind:'select',label:'Region → Region '+i,value:String(i)}));
    const request=buildJevRequest(page(actions),'Select Region 430',[]);
    expect(Object.values(request.body.questions).every(q=>Object.keys(q.criteria).length<=255)).toBe(true);
    const answers={...response(request.body,'SELECT').answers,select_group:answer(Object.keys(request.body.questions.select_group.criteria),'2'),
      select_target_2:answer(Object.keys(request.body.questions.select_target_2.criteria),'1:431'),select_target_0:answer(['invented'],'invented')};
    expect(selectDecision({answers},request).action?.value).toBe('430');
    expect(()=>selectDecision({answers:{...answers,select_target_2:answer(['invented'],'invented')}},request)).toThrow();
  });

  it('types an exact supplied literal from the same Jev call and falls back when uncertain',async()=>{
    for(const fast of [true,false]) {
      const browser=new FakeBrowser();let calls=0;
      const fieldText=vi.fn(async()=> 'generated fallback');
      const result=await new AgentEngine(browser,()=>{},{fieldText,infer:async(_,body)=>{
        if(calls++>0)return response(body,'DONE');
        const result=response(body,'TYPE_TEXT','2');
        const value=Object.entries(body.state.userLiterals as Record<string,string>).find(([,v])=>v==='  exact value  ')![0];
        result.answers.fill_value_2=answer(Object.keys(body.questions.fill_value_2.criteria),fast?value:'NONE');
        // Other fields' speculative responses cannot authorize typing.
        return result;
      }}).run({...config,goal:'Set Destination to "  exact value  "'});
      expect(result).toMatchObject({status:'complete',steps:1});
      expect(fieldText).toHaveBeenCalledTimes(fast?0:1);
      expect(browser.commands.find(c=>c.method==='Input.insertText')?.params?.text).toBe(fast?'  exact value  ':'generated fallback');
    }
  });

  it('offers keyboard search submission and named panel scrolling without accepting arbitrary keys', () => {
    const enter: ObservedAction = { ...fill, id: 'e3', role: 'searchbox', label: 'Submit Search', kind: 'press', key: 'Enter', value: 'London' };
    const request = buildJevRequest(page([fill, enter, { id: 'scroll_down_8', node: 8, kind: 'scroll', label: 'Scroll down in search results', delta: 280 }]), 'Search London', []);
    expect(request.targets.PRESS_ENTER['1']).toEqual(enter);
    expect(selectDecision(response(request.body, 'SCROLL_DOWN_8'), request).action?.node).toBe(8);
    expect(attentionReason(enter)).toBeUndefined();
    expect(attentionReason({ ...enter, form_method: 'post' })).toMatch(/Review/);
    expect(attentionReason({ ...enter, label: 'Submit Message', context: 'Compose new message' })).toMatch(/manually|attention/);
    expect(attentionReason({ ...enter, key: undefined })).toMatch(/Review/);
  });

  it('offers only bounded game keys for a gameplay goal, preserving search Enter guards', () => {
    const key: ObservedAction = { id: 'key_left', node: 3, kind: 'key', role: 'canvas', label: 'Game canvas → ArrowLeft', key: 'ArrowLeft' };
    const request = buildJevRequest(page([key]), 'Play the game', []);
    expect(selectDecision(response(request.body, 'KEY_LEFT', '1'), request).action).toEqual(key);
    expect(buildJevRequest(page([key]), 'Read this page', []).targets).toEqual({});
    expect(attentionReason(key)).toBeUndefined();
    expect(attentionReason({ ...key, key: undefined })).toMatch(/does not support/);
    expect(attentionReason({ ...key, role: 'searchbox' })).toMatch(/does not support/);
    expect(() => buildActionSpace([{ ...key, key: undefined }])).toThrow(/unsupported game key/);
  });

  it('rejects missing, non-finite, unnormalized and non-maximal probabilities', () => {
    expect(validateChoice(answer(['A', 'B'], 'A'), ['A', 'B']).choice).toBe('A');
    for (const invalid of [undefined, { choice: 'A', confidence: 1, probabilities: { A: 1 } },
      { choice: 'A', confidence: NaN, probabilities: { A: 1, B: 0 } },
      { choice: 'A', confidence: 1, probabilities: { A: 0.4, B: 0.2 } },
      { choice: 'A', confidence: 1, probabilities: { A: 0.1, B: 0.9 } },
      { choice: 'C', confidence: 1, probabilities: { A: 1, B: 0 } }]) {
      expect(() => validateChoice(invalid, ['A', 'B'])).toThrow();
    }
  });

  it('accepts the live API rounding near a tie but rejects inconsistent high-precision choices',()=>{
    expect(validateChoice({choice:'A',confidence:0.33,probabilities:{A:0.33,B:0.34,C:0.33}},['A','B','C']).choice).toBe('A');
    for(const probabilities of [{A:0.32,B:0.35,C:0.33},{A:0.333,B:0.334,C:0.333}])
      expect(()=>validateChoice({choice:'A',confidence:0.33,probabilities},['A','B','C'])).toThrow();
  });

  it('consumes only the target head corresponding to the selected operation', () => {
    const request = buildJevRequest(page(), 'Search London', []);
    const result = response(request.body, 'CLICK', '1');
    result.answers.type_text_target = { choice: 'invented-node', confidence: NaN, probabilities: {} };
    expect(selectDecision(result, request).action).toEqual(click);
    result.answers.click_target.choice = 'invented-node';
    expect(() => selectDecision(result, request)).toThrow();
  });

  it('sends structured page state and fan-out heads without image or executable-code output', () => {
    const request = buildJevRequest(page(), 'Search London', []);
    expect(Object.keys(request.body.questions)).toEqual(['operation', 'click_target', 'type_text_target']);
    expect(request.body.state.page).toEqual({ url: 'https://example.com', title: 'Fixture', text: 'Find your destination' });
    expect(JSON.stringify(request.body)).not.toContain('image_url');
  });
});

describe('Agent execution', () => {
  it('executes an observed click and reports DONE without pretending independent verification', async () => {
    const browser = new FakeBrowser();
    const events: AgentEvent[] = [];
    let calls = 0;
    const fieldText = vi.fn();
    const engine = new AgentEngine(browser, event => events.push(event), {
      infer: async (_, body) => response(body, calls++ === 0 ? 'CLICK' : 'DONE', calls === 1 ? '1' : undefined), fieldText,
    });
    const result = await engine.run(config);
    expect(result.status).toBe('complete');
    expect(result.verified).toBe(false);
    expect(result.steps).toBe(1);
    expect(result.page).toEqual({ url: browser.state.url, title: browser.state.title, text: browser.state.text });
    expect(result.actions).toEqual([{ action: 'Search', kind: 'click', page_changed: false }]);
    expect(browser.commands.filter(command => command.method === 'Input.dispatchMouseEvent').map(command => command.params?.type)).toEqual(['mousePressed', 'mouseReleased']);
    expect(fieldText).not.toHaveBeenCalled();
    expect(events.at(-1)?.message).toMatch(/Review the page/);
    expect(events.find(event => event.type === 'decision')?.durationMs).toBeTypeOf('number');
  });

  it('refreshes a stale target before input and never replays the old action', async () => {
    const browser = new FakeBrowser();
    browser.staleTargets = 1;
    let calls = 0;
    const result = await new AgentEngine(browser, () => undefined, {
      infer: async (_, body) => response(body, calls++ < 2 ? 'CLICK' : 'DONE', calls <= 2 ? '1' : undefined),
    }).run(config);
    expect(result.modelCalls).toBe(3);
    expect(result.steps).toBe(1);
    expect(browser.commands.filter(command => command.params?.type === 'mousePressed')).toHaveLength(1);
  });

  it('keeps a generated field value only across retries with identical helper context', async () => {
    const browser = new FakeBrowser();
    browser.staleTargets = 1;
    let calls = 0;
    const fieldText = vi.fn(async () => 'London');
    const result = await new AgentEngine(browser, () => undefined, {
      infer: async (_, body) => response(body, calls++ < 2 ? 'TYPE_TEXT' : 'DONE', calls <= 2 ? '2' : undefined), fieldText,
    }).run(config);
    expect(result.status).toBe('complete');
    expect(fieldText).toHaveBeenCalledTimes(1);
    expect(browser.commands.filter(command => command.method === 'Input.insertText')).toEqual([{ method: 'Input.insertText', params: { text: 'London' } }]);
  });

  it('stops before purchases, messages, deletion and secret entry', async () => {
    for (const label of ['Buy now', 'Send message', 'Delete account']) {
      const browser = new FakeBrowser();
      browser.state = page([{ ...click, label }]);
      const result = await new AgentEngine(browser, () => undefined, { infer: async (_, body) => response(body, 'CLICK', '1') }).run(config);
      expect(result.status).toBe('blocked');
      expect(result.steps).toBe(0);
      expect(browser.commands.some(command => command.method.startsWith('Input.'))).toBe(false);
    }
    expect(attentionReason({ ...fill, label: 'API key' })).toMatch(/sensitive/);
    expect(attentionReason({ ...click, label: 'Continue', context: 'Checkout Payment Credit card' })).toMatch(/manually/);
    expect(attentionReason({ ...click, label: 'Search' })).toBeUndefined();
  });

  it('records a mutation before a failed observation and never clicks it again', async () => {
    const browser = new FakeBrowser();
    browser.failObserveAfterClick = true;
    const events: AgentEvent[] = [];
    const result = await new AgentEngine(browser, event => events.push(event), {
      infer: async (_, body) => response(body, 'CLICK', '1'), observationTimeoutMs: 40,
    }).run(config);
    expect(result.status).toBe('error');
    expect(result.steps).toBe(1);
    expect(browser.observationFailures).toBeGreaterThanOrEqual(2);
    expect(events.some(event => event.type === 'action')).toBe(true);
    expect(browser.commands.filter(command => command.params?.type === 'mousePressed')).toHaveLength(1);
  });

  it('does not type when a click redirects focus', async () => {
    const browser = new FakeBrowser();
    browser.focus = false;
    const result = await new AgentEngine(browser, () => undefined, {
      infer: async (_, body) => response(body, 'TYPE_TEXT', '2'), fieldText: async () => 'London',
    }).run(config);
    expect(result.status).toBe('error');
    expect(browser.commands.some(command => command.method === 'Input.insertText')).toBe(false);
    expect(browser.commands.filter(command => command.params?.type === 'mousePressed')).toHaveLength(1);
  });

  it('cancels before an in-flight model result can cause input', async () => {
    const browser = new FakeBrowser();
    const controller = new AbortController();
    const result = await new AgentEngine(browser, () => undefined, {
      infer: async (_, body) => { controller.abort(); return response(body, 'CLICK', '1'); },
    }).run({ ...config, signal: controller.signal });
    expect(result.status).toBe('stopped');
    expect(browser.commands.some(command => command.method.startsWith('Input.'))).toBe(false);
  });

  it('does not complete a canceled run after a slow outcome check returns', async () => {
    const browser = new FakeBrowser();
    const controller = new AbortController();
    const events: AgentEvent[] = [];
    const result = await new AgentEngine(browser, event => events.push(event), {
      infer: async (_, body) => response(body, 'DONE'),
      verifyOutcome: async () => { controller.abort(); return true; },
    }).run({ ...config, signal: controller.signal });
    expect(result.status).toBe('stopped');
    expect(result.verified).toBe(false);
    expect(events.some(event => event.type === 'complete')).toBe(false);
  });

  it('stops during an unabortable page read and ignores its late result', async () => {
    const browser = new FakeBrowser();
    const controller = new AbortController();
    let began!: () => void;
    const started = new Promise<void>(resolve => { began = resolve; });
    let release!: (state: PageState) => void;
    const pending = new Promise<PageState>(resolve => { release = resolve; });
    vi.spyOn(browser, 'evaluate').mockImplementation(async <T>() => { began(); return pending as Promise<T>; });
    const infer = vi.fn(async (_: unknown, body: JevRequest) => response(body, 'CLICK', '1'));
    const run = new AgentEngine(browser, () => undefined, { infer }).run({ ...config, signal: controller.signal });
    await started;
    controller.abort();
    expect((await run).status).toBe('stopped');
    release(page());
    await Promise.resolve();
    expect(infer).not.toHaveBeenCalled();
    expect(browser.commands.some(command => command.method.startsWith('Input.'))).toBe(false);
  });

  it('recovers when navigation takes longer than the old 200 ms read window', async () => {
    const browser = new FakeBrowser();
    const started = performance.now();
    const original = browser.evaluate.bind(browser);
    let transientFailures = 0;
    vi.spyOn(browser, 'evaluate').mockImplementation(async <T>(expression: string) => {
      if (expression === READ_STATE && performance.now() - started < 240) {
        transientFailures++;
        throw new Error('Execution context was destroyed during navigation');
      }
      return original<T>(expression);
    });
    const result = await new AgentEngine(browser, () => undefined, {
      infer: async (_, body) => response(body, 'DONE'), observationTimeoutMs: 1000,
    }).run(config);
    expect(result.status).toBe('complete');
    expect(transientFailures).toBeGreaterThan(1);
    expect(browser.commands.some(command => command.method.startsWith('Input.'))).toBe(false);
  });

  it('checks focus before Enter and does not type a value to submit search', async () => {
    const browser = new FakeBrowser();
    browser.state = page([{ ...fill, role: 'searchbox', kind: 'press', key: 'Enter', label: 'Submit Search', value: 'London' }]);
    let calls = 0;
    const result = await new AgentEngine(browser, () => undefined, {
      infer: async (_, body) => response(body, calls++ === 0 ? 'PRESS_ENTER' : 'DONE', calls === 1 ? '1' : undefined),
    }).run(config);
    expect(result.status).toBe('complete');
    expect(browser.commands.filter(command => command.method === 'Input.dispatchKeyEvent').map(command => command.params?.key)).toEqual(['Enter', 'Enter']);
    expect(browser.commands.some(command => command.method === 'Input.insertText')).toBe(false);
  });

  it('requires an independent verifier to pass before claiming verification', async () => {
    const engine = new AgentEngine(new FakeBrowser(), () => undefined, {
      infer: async (_, body) => response(body, 'DONE'), verifyOutcome: async () => false,
    });
    expect((await engine.run(config)).status).toBe('blocked');
  });

  it('honors the action budget even when page state keeps changing', async () => {
    const browser = new FakeBrowser();
    const result = await new AgentEngine(browser, () => undefined, {
      infer: async (_, body) => response(body, 'CLICK', '1'),
    }).run({ ...config, maxSteps: 2 });
    expect(result.status).toBe('blocked');
    expect(result.steps).toBe(2);
    expect(result.modelCalls).toBe(2);
  });
});

// Opt-in real Chromium gate. No model network calls; CDP input and outcome checks are real.
it.runIf(process.env.JEVRY_BROWSER_TEST === '1').each(['listbox','presentation'])('distinguishes an open %s filter menu from background links and dispatches its native option',async mode=>{
 const menu=mode==='listbox'?'<div role="listbox" aria-label="Filter operator"><div role="option" id="equals" tabindex="0">= is</div><div role="option" tabindex="0">!= is not</div></div>':
   '<ul role="presentation"><li role="presentation"><a href="#" role="menuitem" id="equals">= is</a></li><li role="presentation"><a href="#" role="menuitem">!= is not</a></li></ul>';
 await realFixture(`<a href="/background">Requested label</a>${menu}
   <nav><ul><li><a role="menuitem" href="#">Navigation one</a></li><li><a role="menuitem" href="#">Navigation two</a></li></ul></nav>
   <div role="menubar"><ul><li><a role="menuitem" href="#">Top menu one</a></li><li><a role="menuitem" href="#">Top menu two</a></li></ul></div>
   <script>window.picked=false;document.querySelector('#equals').onclick=e=>{e.preventDefault();window.picked=e.isTrusted;document.body.append('Operator selected')};</script>`,async(browser,tab)=>{
  let calls=0;
  const result=await new AgentEngine(browser,()=>{},{infer:async(_,body)=>{
    if(calls++)return response(body,'DONE');
    const entries=Object.entries(targetCriteria(body,'CLICK')) as Array<[string,{element:string;popup?:boolean;nearby_text?:string}]>;
    for(const label of ['Requested label','Navigation one','Navigation two','Top menu one','Top menu two']){
      const entry=entries.find(([,v])=>v.element.endsWith(label));expect(entry).toBeDefined();expect(entry![1].popup).toBeUndefined();
    }
    const target=entries.find(([,v])=>v.popup&&v.element.endsWith('= is'))!;
    expect(target[1].nearby_text).toContain('!= is not');
    return response(body,'CLICK',target[0]);
  }}).run({...config,goal:'Choose the equality operator in the open filter.'});
  expect(result).toMatchObject({status:'complete',steps:1});expect(await tab.evaluate('window.picked')).toBe(true);
 });
});
it.runIf(process.env.JEVRY_BROWSER_TEST === '1')('waits for a finite menu transition without waiting for an unrelated infinite spinner',async()=>{
 await realFixture(`<style>#menu{width:0;overflow:hidden;transition:width .2s}#menu.open{width:200px}#choice{margin-left:100px;width:100px}@keyframes spin{to{transform:rotate(360deg)}}#spinner{width:10px;height:10px;animation:spin 1s infinite}</style><button id="open">Open menu</button><div id="menu"><button id="choice">Choose item</button></div><div id="spinner">*</div><script>window.clicked=[];document.querySelector('#open').onclick=e=>{window.clicked.push(e.isTrusted);document.querySelector('#menu').classList.toggle('open')};document.querySelector('#choice').onclick=e=>{window.clicked.push(e.isTrusted);document.body.append('Selected item')};</script>`,async(browser,tab)=>{
  const observations:unknown[]=[];
  const result=await new AgentEngine(browser,()=>{},{infer:async(_,body)=>{
    const state=body.state as any;if(state.page.text.includes('Selected item'))return response(body,'DONE');
    observations.push({text:state.page.text,elements:state.elements});
    const target=state.elements.find((e:any)=>e.label==='Choose item')||state.elements.find((e:any)=>e.label==='Open menu');
    return response(body,'CLICK',target.index);
  }}).run({...config,goal:'Open the menu and choose the item.',maxSteps:3});
  expect(result,JSON.stringify(observations)).toMatchObject({status:'complete',steps:2});expect(await tab.evaluate(()=> (window as any).clicked)).toEqual([true,true]);
 });
});

it.runIf(process.env.JEVRY_BROWSER_TEST === '1')('keeps controls after a large dropdown and avoids repeating its form context for every option',async()=>{
 await realFixture(`<form><label>Region<select>${Array.from({length:450},(_,i)=>'<option>Region '+i+'</option>').join('')}</select></label><a href="/profile">Edit biography</a></form>`,async(browser)=>{
   const state=await browser.evaluate<PageState>(READ_STATE);expect(state.actions.some(a=>a.label==='Edit biography')).toBe(true);
   const request=buildJevRequest(state,'Edit my biography.',[]);expect(Object.keys(request.targets.SELECT)).toHaveLength(449);
   expect(JSON.stringify(request.body).length).toBeLessThan(45000);
   expect(Object.values(request.body.questions).every(q=>Object.keys(q.criteria).length<=255)).toBe(true);
   expect(JSON.stringify(request.body)).toContain('Region 449');expect(JSON.stringify(request.body.state)).not.toContain('Region 449');
 });
});

it.runIf(process.env.JEVRY_BROWSER_TEST === '1')('reads rendered table rows below the viewport while excluding hidden rows and offscreen click actions',async()=>{
 await realFixture(`<table><thead><tr><th>Item</th><th>Count</th></tr></thead><tbody><tr><td>Visible item</td><td>2</td></tr><tr style="height:1200px"><td>Spacer item</td><td>3</td></tr><tr><td><button>Offscreen item</button></td><td>17</td></tr><tr hidden><td>Hidden secret</td><td>100</td></tr></tbody></table>`,async(browser)=>{
   const state=await browser.evaluate<PageState>(READ_STATE);
   expect(state.text).not.toContain('Offscreen item');expect(state.actions.some(a=>a.label==='Offscreen item')).toBe(false);
   expect(state.tables).toEqual([{headers:['Item','Count'],rows:[['Visible item','2'],['Spacer item','3'],['Offscreen item','17']],truncated:false}]);
 });
});

it.runIf(process.env.JEVRY_BROWSER_TEST === '1')('grounds unlabeled table filters in their columns and clicks a sortable header with native input',async()=>{
 await realFixture(`<table><thead><tr><th>ID</th><th>Review</th><th id="uses" style="cursor:pointer">Uses</th></tr><tr><th><input id="id-filter"></th><th><input id="review-filter"></th><th><input placeholder="From"></th></tr></thead><tbody><tr><td>9</td><td>Public review</td><td>4</td></tr></tbody></table><script>window.sorted=false;document.querySelector('#uses').onclick=e=>{window.sorted=e.isTrusted;document.querySelector('#uses').setAttribute('aria-sort','descending');};</script>`,async(browser,tab)=>{
   const observed=await browser.evaluate<PageState>(READ_STATE);
   expect(observed.actions.filter(a=>a.kind==='fill').map(a=>a.label)).toEqual(['ID','Review','Uses From']);
   let step=0;
   const result=await new AgentEngine(browser,()=>{},{fieldText:async()=> 'term',infer:async(_,body)=>{
     const operation=step===0?'TYPE_TEXT':step===1?'CLICK':'DONE',label=step++===0?'Review':'Uses';
     const target=Object.entries(targetCriteria(body,operation)).find(([,value])=>(value as {element:string}).element.endsWith('] '+label))?.[0];
     return response(body,operation,target);
   }}).run({...config,goal:'Filter the review text and sort by uses'});
   expect(result).toMatchObject({status:'complete',steps:2});
   expect(await tab.locator('#review-filter').inputValue()).toBe('term');
   expect(await tab.locator('#id-filter').inputValue()).toBe('');
   expect(await tab.evaluate('window.sorted')).toBe(true);
 });
},15000);

it.runIf(process.env.JEVRY_BROWSER_TEST === '1')('runs fill → native select → search against a real isolated-world CDP page', async () => {
  const { chromium } = await import('@playwright/test');
  const chromiumBrowser = await chromium.launch({ headless: true, executablePath: process.env.JEVRY_BROWSER_EXECUTABLE || undefined });
  try {
    const tab = await chromiumBrowser.newPage({ viewport: { width: 1100, height: 760 } });
    await tab.setContent(`<html><head><title>Engine fixture</title></head><body><h1>Find a stay</h1>
      <form><label for="destination">Destination</label><input id="destination" value="Berlin">
      <label for="guests">Guests</label><select id="guests"><option value="1">1 guest</option><option value="2">2 guests</option></select>
      <button type="submit">Find stays</button></form><p id="results">Awaiting a search</p>
      <script>document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();
      document.querySelector('#results').textContent='Stays in '+document.querySelector('input').value+' for '+document.querySelector('select').value+' guests';})</script></body></html>`);
    const session = await tab.context().newCDPSession(tab);
    const { frameTree } = await session.send('Page.getFrameTree');
    const { executionContextId } = await session.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'jevry-engine-test' });
    const evaluate = async <T>(expression: string): Promise<T> => {
      const result = await session.send('Runtime.evaluate', { expression, contextId: executionContextId, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      return result.result.value;
    };
    const steps = [['TYPE_TEXT', 'Destination'], ['SELECT', 'Guests → 2 guests'], ['CLICK', 'Find stays'], ['DONE']];
    const events: AgentEvent[] = [];
    const engine = new AgentEngine({
      evaluate, cdp: (method, params) => session.send(method as Parameters<typeof session.send>[0], params),
      url: () => tab.url(), navigate: async url => { await tab.goto(url); },
    }, event => events.push(event), {
      infer: async (_, body) => {
        const [operation, label] = steps.shift()!;
        let target: string | undefined;
        if (label) {
          const criteria = targetCriteria(body,operation);
          target = Object.entries(criteria).find(([, value]) => (value as { element: string }).element.includes(label))?.[0];
          if (!target) throw new Error(`Observed target missing: ${label}`);
        }
        return response(body, operation, target);
      },
      fieldText: async () => 'London',
      verifyOutcome: async () => (await tab.locator('#results').innerText()) === 'Stays in London for 2 guests',
    });
    const result = await engine.run({ ...config, goal: 'Find stays in London for 2 guests' });
    expect(result.status).toBe('complete');
    expect(result.verified).toBe(true);
    expect(result.steps).toBe(3);
    expect(events.filter(event => event.type === 'action').map(event => event.operation)).toEqual(['TYPE_TEXT', 'SELECT', 'CLICK']);
    expect(await tab.locator('#results').innerText()).toBe('Stays in London for 2 guests');
    // The page cannot replace the agent's reference registry in its isolated world.
    await tab.evaluate('window.__jevFast={nodes:new Map(),guard:undefined}');
    expect(await evaluate('typeof window.__jevFast.guard')).toBe('function');
  } finally {
    await chromiumBrowser.close();
  }
}, 15_000);

const htmlAttribute = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

it.runIf(process.env.JEVRY_BROWSER_TEST === '1')('maps nested same-origin iframe and shadow controls into top-page CDP coordinates', async () => {
  const child = `<!doctype html><html><head><title>Embedded search</title></head><body style="margin:18px"><search-widget></search-widget>
    <script>const root=document.querySelector('search-widget').attachShadow({mode:'open'});
    root.innerHTML='<form role="search"><label id="label">Search cities</label><input aria-labelledby="label" type="search" value="Berlin"></form><button id="open">Open result</button><p id="result">Ready</p>';
    root.querySelector('form').addEventListener('submit',e=>{e.preventDefault();root.querySelector('#result').textContent='Results for '+root.querySelector('input').value;});
    root.querySelector('#open').addEventListener('click',()=>{root.querySelector('#result').textContent+=' opened';});</script></body></html>`;
  const outer = `<!doctype html><html><body style="margin:20px"><iframe title="Inner search" style="width:470px;height:190px;border:9px solid" srcdoc="${htmlAttribute(child)}"></iframe></body></html>`;
  await realFixture(`<html><head><title>Frame host</title></head><body><h1>Embedded results</h1><iframe title="Outer frame" role="button" aria-label="Misleading wrapper" style="margin-left:110px;width:550px;height:300px;border:11px solid" srcdoc="${htmlAttribute(outer)}"></iframe></body></html>`, async (browser, tab) => {
    const initial = await browser.evaluate<PageState>(READ_STATE);
    expect(initial.actions.find(action => action.kind === 'fill')).toMatchObject({ label: 'Search cities', frame: 'Embedded search' });
    expect(initial.actions.some(action => action.label === 'Misleading wrapper')).toBe(false);
    const steps = ['TYPE_TEXT', 'PRESS_ENTER', 'CLICK', 'DONE'];
    const result = await new AgentEngine(browser, () => undefined, {
      infer: async (_, body) => {
        const operation = steps.shift()!;
        const criteria = targetCriteria(body,operation);
        const target = criteria ? Object.entries(criteria).find(([, value]) => operation !== 'CLICK' || (value as { element: string }).element.endsWith('Open result'))?.[0] : undefined;
        return response(body, operation, target);
      }, fieldText: async () => 'London', verifyOutcome: async state => state.text.includes('Results for London opened'),
    }).run({ ...config, goal: 'Search London and open its result' });
    expect(result.status, result.message).toBe('complete');
    expect(result).toMatchObject({ verified: true, steps: 3 });
    expect(await tab.frameLocator('iframe').frameLocator('iframe').locator('#result').innerText()).toBe('Results for London opened');
  });
}, 15_000);

it.runIf(process.env.JEVRY_BROWSER_TEST === '1')('rejects a stale iframe document even when its replacement keeps the same srcdoc URL', async () => {
  const child = `<html><body><button onclick="parent.clicked++">Open result</button></body></html>`;
  await realFixture(`<html><body><script>window.clicked=0;</script><iframe style="width:400px;height:180px" srcdoc="${htmlAttribute(child)}"></iframe></body></html>`, async (browser, tab) => {
    const oldReference = (await browser.evaluate<PageState>(READ_STATE)).actions.find(action => action.kind === 'click')!.node;
    let calls = 0;
    const result = await new AgentEngine(browser, () => undefined, {
      infer: async (_, body) => {
        if (calls++ === 0) {
          await tab.locator('iframe').evaluate((frame: HTMLIFrameElement) => { frame.srcdoc = '<html><body>Replacement document<button onclick="parent.clicked++">Open result</button></body></html>'; });
          await tab.frameLocator('iframe').getByText('Replacement document').waitFor();
          return response(body, 'CLICK', Object.keys(targetCriteria(body,'CLICK'))[0]);
        }
        return response(body, 'DONE');
      }, verifyOutcome: async state => state.text.includes('Replacement document'),
    }).run(config);
    expect(result).toMatchObject({ status: 'complete', verified: true, steps: 0, modelCalls: 2 });
    expect(await tab.evaluate('window.clicked')).toBe(0);
    expect(await browser.evaluate(`window.__jevFast.nodes.has(${oldReference})`)).toBe(false);
  });
}, 15_000);

it.runIf(process.env.JEVRY_BROWSER_TEST === '1')('excludes opaque-origin, hidden, transformed and zoomed iframe controls', async () => {
  const contents = (label: string) => htmlAttribute(`<html><body><button>${label}</button></body></html>`);
  await realFixture(`<html><body>
    <iframe sandbox srcdoc="${contents('Opaque origin target')}"></iframe>
    <iframe style="display:none" srcdoc="${contents('Hidden frame target')}"></iframe>
    <div style="transform:translateX(10px)"><iframe srcdoc="${contents('Transformed frame target')}"></iframe></div>
    <iframe style="zoom:1.25" srcdoc="${contents('Zoomed frame target')}"></iframe>
    </body></html>`, async browser => {
    const state = await browser.evaluate<PageState>(READ_STATE);
    expect(state.actions.some(action => action.kind === 'click')).toBe(false);
    expect(state.text).not.toMatch(/origin target|frame target/);
    expect(state.unsupported_frames).toBe(4);
    expect((buildJevRequest(state, 'Open target', []).body.state.page as { unsupported_frames: number }).unsupported_frames).toBe(4);
  });
}, 15_000);

it.runIf(process.env.JEVRY_BROWSER_TEST === '1')('scrolls an iframe viewport before clicking a newly visible result', async () => {
  const child = `<!doctype html><html><head><title>Frame results</title></head><body style="margin:0">
    ${Array.from({ length: 10 }, (_, i) => `<button style="display:block;width:100%;height:42px" onclick="parent.document.querySelector('#result').textContent='Opened ${i + 1}'">Frame destination ${i + 1}</button>`).join('')}
    </body></html>`;
  await realFixture(`<html><body><iframe style="width:420px;height:150px;border:5px solid" srcdoc="${htmlAttribute(child)}"></iframe><p id="result">Waiting</p></body></html>`, async browser => {
    const initial = await browser.evaluate<PageState>(READ_STATE);
    expect(initial.actions.some(action => action.label === 'Frame destination 10')).toBe(false);
    const result = await new AgentEngine(browser, () => undefined, {
      infer: async (_, body) => {
        if ((body.state.page as { text: string }).text.includes('Opened 10')) return response(body, 'DONE');
        const target = Object.entries(targetCriteria(body,'CLICK')).find(([, value]) => (value as { element: string }).element.endsWith('Frame destination 10'))?.[0];
        if (target) return response(body, 'CLICK', target);
        return response(body, Object.keys(operationCriteria(body)).find(operation => operation.startsWith('SCROLL_DOWN_'))!);
      }, verifyOutcome: async state => state.text.includes('Opened 10'),
    }).run({ ...config, goal: 'Open Frame destination 10', maxSteps: 10 });
    expect(result.status, result.message).toBe('complete');
    expect(result.verified).toBe(true);
    expect(result.actions?.some(action => action.kind === 'scroll' && action.page_changed)).toBe(true);
  });
}, 15_000);

async function realFixture(html: string, check: (browser: BrowserAdapter, tab: import('@playwright/test').Page) => Promise<void>) {
  const { chromium } = await import('@playwright/test');
  const runtime = await chromium.launch({ headless: true, executablePath: process.env.JEVRY_BROWSER_EXECUTABLE || undefined });
  try {
    const tab = await runtime.newPage({ viewport: { width: 1100, height: 760 } });
    await tab.setContent(html);
    const session = await tab.context().newCDPSession(tab);
    const { frameTree } = await session.send('Page.getFrameTree');
    const { executionContextId } = await session.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'jevry-component-test' });
    await check({
      evaluate: async <T>(expression: string): Promise<T> => {
        const result = await session.send('Runtime.evaluate', { expression, contextId: executionContextId, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result.value;
      },
      cdp: (method, params) => session.send(method as Parameters<typeof session.send>[0], params),
      url: () => tab.url(), navigate: async url => { await tab.goto(url); },
    }, tab);
  } finally { await runtime.close(); }
}

it.runIf(process.env.JEVRY_BROWSER_TEST === '1')('fills and submits an open-shadow search with native Enter events and reads its result', async () => {
  await realFixture(`<html><head><title>Component search</title></head><body><search-widget></search-widget>
    <script>const root=document.querySelector('search-widget').attachShadow({mode:'open'});
    root.innerHTML='<form role="search"><label id="label">Search destinations</label><input aria-labelledby="label" type="search" value="Berlin"></form><p id="result">Search is ready</p>';
    root.querySelector('form').addEventListener('submit',event=>{event.preventDefault();root.querySelector('#result').textContent='Available stays in '+root.querySelector('input').value;});</script></body></html>`, async (browser, tab) => {
    const initial = await browser.evaluate<PageState>(READ_STATE);
    expect(initial.actions.find(action => action.kind === 'fill')?.label).toBe('Search destinations');
    const steps = ['TYPE_TEXT', 'PRESS_ENTER', 'DONE'];
    const result = await new AgentEngine(browser, () => undefined, {
      infer: async (_, body) => {
        const operation = steps.shift()!;
        const target = operation === 'DONE' ? undefined : Object.keys(targetCriteria(body,operation))[0];
        return response(body, operation, target);
      },
      fieldText: async () => 'London',
      verifyOutcome: async state => state.text.includes('Available stays in London'),
    }).run({ ...config, goal: 'Search for stays in London' });
    expect(result).toMatchObject({ status: 'complete', verified: true, steps: 2 });
    expect(result.page?.text).toContain('Available stays in London');
    expect(await tab.locator('search-widget input').inputValue()).toBe('London');
    await tab.evaluate('window.__jevFast={nodes:new Map()}');
    expect(await browser.evaluate('typeof window.__jevFast.point')).toBe('function');
  });
}, 15_000);

it.runIf(process.env.JEVRY_BROWSER_TEST === '1')('scrolls a nested result panel until a clipped target becomes actionable', async () => {
  await realFixture(`<html><head><title>Scrollable results</title></head><body><h1>Destinations</h1>
    <section aria-label="Destination results" style="height:160px;width:420px;overflow-y:auto;border:1px solid">
    ${Array.from({ length: 12 }, (_, i) => `<button style="display:block;height:48px;width:100%" onclick="document.querySelector('#result').textContent='Opened destination ${i + 1}'">Destination ${i + 1}</button>`).join('')}
    </section><p id="result">Select a destination</p></body></html>`, async browser => {
    const initial = await browser.evaluate<PageState>(READ_STATE);
    expect(initial.actions.some(action => action.label === 'Destination 12')).toBe(false);
    expect(initial.text).not.toContain('Destination 12');
    expect(initial.actions.some(action => action.kind === 'scroll' && action.node)).toBe(true);
    const result = await new AgentEngine(browser, () => undefined, {
      infer: async (_, body) => {
        if ((body.state.page as { text: string }).text.includes('Opened destination 12')) return response(body, 'DONE');
        const target = Object.entries(targetCriteria(body,'CLICK')).find(([, value]) => (value as { element: string }).element.endsWith('Destination 12'))?.[0];
        if (target) return response(body, 'CLICK', target);
        return response(body, Object.keys(operationCriteria(body)).find(operation => operation.startsWith('SCROLL_DOWN_'))!);
      },
      verifyOutcome: async state => state.text.includes('Opened destination 12'),
    }).run({ ...config, goal: 'Open Destination 12', maxSteps: 10 });
    expect(result.status, result.message).toBe('complete');
    expect(result.verified).toBe(true);
    expect(result.actions?.filter(action => action.kind === 'scroll').every(action => action.page_changed)).toBe(true);
    expect(result.actions?.at(-1)?.action).toBe('Destination 12');
  });
}, 15_000);

it.runIf(process.env.JEVRY_BROWSER_TEST === '1')('excludes covered targets and disabled or sensitive shadow controls', async () => {
  await realFixture(`<html><body>
    <button style="position:absolute;top:20px;left:20px;width:120px;height:50px">Covered</button>
    <div style="position:absolute;top:20px;left:20px;width:120px;height:50px;z-index:1;background:white">Overlay</div>
    <div style="margin-top:100px"><disabled-widget aria-disabled="true"></disabled-widget><secret-widget></secret-widget></div>
    <script>document.querySelector('disabled-widget').attachShadow({mode:'open'}).innerHTML='<button>Disabled inside shadow</button>';
    document.querySelector('secret-widget').attachShadow({mode:'open'}).innerHTML='<input type="password" aria-label="Password" value="do-not-read"><input aria-label="Search" type="search" value="Rome">';</script>
    </body></html>`, async browser => {
    const state = await browser.evaluate<PageState>(READ_STATE);
    expect(state.actions.map(action => action.label)).not.toContain('Covered');
    expect(state.actions.map(action => action.label)).not.toContain('Disabled inside shadow');
    expect(state.actions.map(action => action.label)).not.toContain('Password');
    expect(JSON.stringify(state)).not.toContain('do-not-read');
    expect(state.actions.some(action => action.label === 'Search' && action.kind === 'fill')).toBe(true);
  });
}, 15_000);

const gameFixture = `<!doctype html><html><head><title>Keyboard game</title></head><body>
  <div id="welcome" style="position:relative;width:300px;padding:24px">
    Welcome to the game! Would you like a tutorial?
    <button id="dismiss" style="position:absolute;right:0;top:0;width:24px;height:24px" onclick="this.parentElement.remove()"><svg width="10" height="10"><path d="M0 0L10 10M10 0L0 10" /></svg></button>
  </div>
  <input id="search" aria-label="Search" value="keep this text">
  <canvas width="300" height="300" style="display:block" tabindex="0"></canvas>
  <p id="score" role="status">Score 0</p>
  <script>
    window.keys=[];window.trusted=[];
    document.querySelector('canvas').addEventListener('keydown',e=>{
      if(!['ArrowLeft','ArrowUp','ArrowRight','ArrowDown'].includes(e.key))return;
      e.preventDefault();window.keys.push(e.key);window.trusted.push(e.isTrusted);
      const ctx=e.currentTarget.getContext('2d');ctx.fillStyle=window.keys.length%2?'red':'blue';ctx.fillRect(0,0,300,300);
      if(window.keys.length>=4)document.querySelector('#score').textContent='Score '+window.keys.length*4;
    });
  </script></body></html>`;

it.runIf(process.env.JEVRY_BROWSER_TEST === '1').each(['win','task'] as const)('repairs a bad map point and continues native iframe map and ordinary panel inputs in %s mode',async(mode)=>{
 const completedText=mode==='task'?'Construction orders queued':'You win!';
 const child=`<html><body style="margin:0"><canvas width="400" height="300" aria-label="Province map"></canvas>
 <p id="state">Inspect the first location</p><button id="queue" hidden>Queue workshop</button><script>
 window.receipts=[];let stage=0,selected=false;const map=document.querySelector('canvas'),c=map.getContext('2d');
 const draw=()=>{c.fillStyle=stage?'#8ac':'#aca';c.fillRect(0,0,400,300);c.fillStyle='#123';c.fillRect(stage?280:80,stage?180:80,40,40);};draw();
 map.addEventListener('click',e=>{const x=e.offsetX,y=e.offsetY;receipts.push({kind:'point',trusted:e.isTrusted,x,y});
   if(Math.abs(x-(stage?300:100))>15||Math.abs(y-(stage?200:100))>15)return;
   selected=true;document.querySelector('#state').textContent='Selected owned location';document.querySelector('#queue').hidden=false;});
 document.querySelector('#queue').addEventListener('click',e=>{receipts.push({kind:'order',trusted:e.isTrusted});if(!selected)return;selected=false;stage++;
   document.querySelector('#queue').hidden=true;document.querySelector('#state').textContent=stage===2?'${completedText}':'Inspect the second location';draw();});
 </script></body></html>`;
 await realFixture(`<html><body><iframe style="margin:60px 0 0 100px;width:430px;height:420px;border:5px solid" srcdoc="${htmlAttribute(child)}"></iframe></body></html>`,async(browser,tab)=>{
   let analyses=0;const events:AgentEvent[]=[];
   const result=await new AgentEngine(browser,event=>events.push(event),{
     gameInfer:async(_config,prompt)=>{
       analyses++;const raw=prompt.split('UNTRUSTED_CONTEXT: ')[1].split('\nThe previous analysis')[0];const context=JSON.parse(raw);
       expect(context.surfaces).toHaveLength(1);expect(context.surfaces[0].rect).toMatchObject({width:400,height:300});
       expect(context.surfaces[0].rect.x).toBeGreaterThan(100);expect(context.surfaces[0].rect.y).toBeGreaterThan(60);
       const second=context.page.page.text.includes('second location');
       return JSON.stringify({strategy:'Inspect each location, then use its queue control.',observation:'Visible map and current order panel.',grid:null,controls:['pointer'],points:[{
         target:context.surfaces[0].target,x:analyses===1?100:second?.75:.25,y:second?2/3:1/3,label:'Inspect the visible location',
       }]});
     },
     infer:async(_,body)=>{
       if(body.questions.coverage) {
         const evidence=body.state.untrustedEvidence as Record<string,string>;
         const source=Object.keys(evidence).find(key=>evidence[key].includes(completedText));
         expect(source).toBeDefined();
         return {answers:{criterion_0:answer(Object.keys(body.questions.criterion_0.criteria),source!),coverage:answer(['COMPLETE','INCOMPLETE'],'COMPLETE')}};
       }
       const text=(body.state.page as {text:string}).text;
       if(text.includes(completedText))return response(body,'DONE');
       const queue=Object.entries(targetCriteria(body,'CLICK')).find(([,value])=>(value as {element:string}).element.includes('Queue workshop'));
       return queue?response(body,'CLICK',queue[0]):response(body,'POINT',Object.keys(body.questions.point_target.criteria)[0]);
     },
     verifyOutcome:async p=>p.text.includes(completedText),
   }).run({...config,gameMode:mode,goal:'Complete the map orders',maxSteps:8,
     ...(mode==='task'?{contract:{success:['Construction orders are queued'],constraints:[],progressOnly:[]}}:{})});
   expect(result).toMatchObject({status:'complete',verified:true,steps:4});
   if(mode==='task')expect(result.completionEvidence).toHaveLength(1);
   const receipts=await tab.frameLocator('iframe').locator('body').evaluate(()=> (window as unknown as {receipts:unknown[]}).receipts);
   expect(receipts).toEqual([{kind:'point',trusted:true,x:100,y:100},{kind:'order',trusted:true},{kind:'point',trusted:true,x:300,y:200},{kind:'order',trusted:true}]);
   expect(analyses).toBe(3);expect(events.filter(e=>e.type==='action').map(e=>e.operation)).toEqual(['POINT','CLICK','POINT','CLICK']);
 });
},20_000);

it.runIf(process.env.JEVRY_BROWSER_TEST === '1')('reads new numeric tile appearances locally, then reuses their templates and the game calibration',async()=>{
  try {
    await realFixture(`<html><body><canvas width="400" height="400"></canvas><script>
      window.draw=(values)=>{const c=document.querySelector('canvas').getContext('2d');
      values.forEach((v,i)=>{const x=i%4*100,y=Math.floor(i/4)*100;c.fillStyle=v>=8?'#f59563':v?'#eee4da':'#bbada0';c.fillRect(x,y,100,100);
      if(v){c.fillStyle=v>=8?'white':'#776e65';c.font='bold '+(String(v).length>3?32:48)+'px Arial';c.textAlign='center';c.textBaseline='middle';c.fillText(String(v),x+50,y+50);}})};
      draw([2,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0]);</script></body></html>`,async(browser,tab)=>{
      let reviews=0;
      const strategy=new GameStrategy(async(_config,prompt)=>{
        reviews++;const context=JSON.parse(prompt.split('UNTRUSTED_CONTEXT: ')[1]);
        return JSON.stringify({strategy:'Combine equal numbered tiles.',observation:'Two numbers on a grid.',controls:['arrows'],
          grid:{target:Object.keys(context.pointTargets)[0],rows:4,columns:4,bounds:{x:0,y:0,width:1,height:1},cells:[['2','4','empty','empty'],...Array.from({length:3},()=>Array(4).fill('empty'))]},
          merge:{kind:'slide_equal',emptyLabel:'empty',goal:2048,spawns:[{value:2,probability:.9},{value:4,probability:.1}]}});
      });
      async function prepare() {const page=await browser.evaluate<PageState>(READ_STATE);return strategy.prepare(browser,page,buildJevRequest(page,'Win the game',[],undefined,true),'Win','win',[],config.textConfig);}
      await prepare();
      await tab.evaluate('draw([16,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0])');
      const learned=await prepare();
      expect(learned.request.body.state.game).toMatchObject({board:{cells:[['16','2','empty','empty'],...Array.from({length:3},()=>Array(4).fill('empty'))]}});
      strategy.beginRun();
      await tab.evaluate('draw([0,16,2,0,0,0,0,0,0,0,0,0,0,0,0,0])');
      const moved=await prepare();
      expect(moved.request.body.state.game).toMatchObject({board:{cells:[['empty','16','2','empty'],...Array.from({length:3},()=>Array(4).fill('empty'))]}});
      await tab.evaluate('draw([32,64,8,4,0,0,0,0,0,0,0,0,0,0,0,0])');
      const newNumbers=await prepare();
      expect(newNumbers.request.body.state.game).toMatchObject({board:{cells:[['32','64','8','4'],...Array.from({length:3},()=>Array(4).fill('empty'))]}});
      await tab.locator('canvas').evaluate(e=>{(e as HTMLElement).style.cssText='width:320px;height:320px;margin-left:50px';});
      const resized=await prepare();
      expect(resized.request.body.state.game).toMatchObject({board:{cells:[['32','64','8','4'],...Array.from({length:3},()=>Array(4).fill('empty'))]}});
      expect(reviews).toBe(1);expect(Object.keys(moved.request.body.questions)).toEqual(['operation']);
      const choices=moved.request.body.questions.operation.criteria as Record<string,{legal:boolean;forecastRank:number;estimatedPositionValue:number}>;
      expect(choices.KEY_UP).toBeUndefined(); // Tiles already occupy the top row.
      expect(Object.values(choices).every(choice=>choice.legal)).toBe(true);
      const best=Math.max(...Object.values(choices).map(choice=>choice.estimatedPositionValue));
      expect(Object.values(choices).filter(choice=>choice.forecastRank===1).every(choice=>choice.estimatedPositionValue===best)).toBe(true);
      expect(Object.values(choices).some(choice=>choice.forecastRank===1)).toBe(true);
      await tab.evaluate("document.body.insertAdjacentHTML('beforeend','<p>Score 5000</p>')");
      await prepare();
      expect(strategy.progress()).toMatchObject({current:64,target:2048,targetReached:false});
      await tab.evaluate('draw([2048,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0])');
      const reached=await prepare();
      expect(strategy.progress()).toMatchObject({current:2048,target:2048,targetReached:true});
      expect(Object.keys(reached.request.body.questions.operation.criteria).some(key=>key.startsWith('KEY_'))).toBe(false);
      expect(reached.request.body.questions.operation.criteria.DONE).toBeDefined();
      expect(reviews).toBe(1);
    });
  }finally{await numericOcr.close();}
},15_000);

it.runIf(process.env.JEVRY_BROWSER_TEST === '1').each(['#new-game','#search'])('starts win-mode keys on a non-focusable canvas after %s held focus and the page changed during analysis', async initialFocus => {
  await realFixture(`<!doctype html><html><body>
    <button id="new-game">New Game</button><input id="search" aria-label="Search" value="keep this text">
    <canvas width="200" height="200" style="display:block"></canvas>
    <p id="score">Score 0</p><p role="status">Ready</p><aside>Advertisement</aside>
    <script>window.keys=[];window.boardClicks=0;
    const board=document.querySelector('canvas');board.addEventListener('click',()=>window.boardClicks++);
    board.addEventListener('keydown',e=>{e.preventDefault();window.keys.push({key:e.key,trusted:e.isTrusted});document.querySelector('#score').textContent='Score 4';document.querySelector('[role=status]').textContent='You win!';});
    </script></body></html>`, async (browser,tab)=>{
    await tab.locator(initialFocus).focus();
    let visualCalls=0;const events:AgentEvent[]=[];
    const result=await new AgentEngine(browser,e=>events.push(e),{
      gameInfer:async()=>{visualCalls++;await tab.locator('aside').evaluate(e=>{e.textContent='Advertisement refreshed during visual analysis';});return JSON.stringify({strategy:'Use an arrow to advance the game.',observation:'The board is ready.',outcome:'ongoing',controls:['arrows'],grid:null});},
      infer:async(_,body)=>{
        const text=(body.state.page as {text:string}).text;
        expect(text).toContain('Advertisement refreshed during visual analysis');
        return response(body,text.includes('You win!')?'DONE':'KEY_LEFT');
      },
      verifyOutcome:async p=>p.text.includes('You win!'),
    }).run({...config,goal:'Try to win this game',gameMode:'win'});
    expect(result,result.message).toMatchObject({status:'complete',verified:true,steps:1});
    expect(visualCalls).toBe(1);
    expect(await tab.evaluate('window.keys')).toEqual([{key:'ArrowLeft',trusted:true}]);
    expect(await tab.evaluate('window.boardClicks')).toBe(0);
    expect(await tab.locator('#search').inputValue()).toBe('keep this text');
    expect(await tab.locator('canvas').getAttribute('tabindex')).toBeNull();
    expect(events.some(e=>e.message.includes('after execution began'))).toBe(false);
  });
},15_000);

it.runIf(process.env.JEVRY_BROWSER_TEST === '1')('dismisses an unnamed welcome control and plays with trusted native arrow keys, despite canvas-only early moves', async () => {
  await realFixture(gameFixture, async (browser, tab) => {
    await tab.evaluate(()=>{(window as any).boardClicks=0;document.querySelector('canvas')!.addEventListener('click',()=>{(window as any).boardClicks++;});});
    await tab.locator('#search').focus();
    let keys = 0;
    const operations = ['KEY_LEFT', 'KEY_UP', 'KEY_RIGHT', 'KEY_DOWN'];
    const result = await new AgentEngine(browser, () => {}, {
      infer: async (_, body) => {
        const welcome = Object.entries(body.questions.click_target?.criteria || {}).find(([, v]) => /Unlabeled button at top right.*Welcome/.test((v as { element: string }).element));
        if (welcome) return response(body, 'CLICK', welcome[0]);
        if (keys === 8) return response(body, 'DONE');
        const op = operations[keys++ % 4];
        return response(body, op, '1');
      }, verifyOutcome: async p => p.text.includes('Score 32'),
    }).run({ ...config, goal: 'Play the game and demonstrate several moves' });
    expect(result, result.message).toMatchObject({ status: 'complete', verified: true, steps: 9 });
    expect(result.actions?.filter(a => a.kind === 'key').slice(0, 3).map(a => a.page_changed)).toEqual([null, null, null]);
    expect(await tab.evaluate('window.keys')).toEqual(['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']);
    expect(await tab.evaluate('window.trusted.every(Boolean)')).toBe(true);
    expect(await tab.evaluate('window.boardClicks')).toBe(0);
    expect(await tab.locator('#search').inputValue()).toBe('keep this text');
    expect(await tab.locator('#welcome').count()).toBe(0);
  });
}, 15_000);

it.runIf(process.env.JEVRY_BROWSER_TEST === '1')('withholds game keys from covered, disabled and modal-blocked canvases', async () => {
  await realFixture(gameFixture, async (browser, tab) => {
    expect((await browser.evaluate<PageState>(READ_STATE)).actions.filter(a => a.kind === 'key')).toHaveLength(10);
    for (const markup of [
      '<dialog open style="position:fixed;inset:20px">Choose an option<button>Continue</button></dialog>',
      '<div role="dialog" style="position:fixed;inset:20px">Preferences<button>Save</button></div>',
      '<div style="position:fixed;inset:0;background:white;z-index:999">Overlay</div>',
    ]) {
      await tab.evaluate(html => { document.body.insertAdjacentHTML('beforeend', `<section id="cover">${html}</section>`); }, markup);
      expect((await browser.evaluate<PageState>(READ_STATE)).actions.filter(a => a.kind === 'key')).toEqual([]);
      await tab.locator('#cover').evaluate(e => e.remove());
    }
    await tab.locator('canvas').evaluate(e => e.setAttribute('aria-disabled', 'true'));
    expect((await browser.evaluate<PageState>(READ_STATE)).actions.filter(a => a.kind === 'key')).toEqual([]);
  });
}, 15_000);

it.runIf(process.env.JEVRY_BROWSER_TEST === '1')('does not send game keys into a field that steals board focus', async () => {
  await realFixture(gameFixture, async (browser, tab) => {
    await tab.evaluate(() => { document.querySelector('canvas')!.addEventListener('focus', () => (document.querySelector('#search') as HTMLElement).focus()); });
    const result = await new AgentEngine(browser, () => {}, {
      infer: async (_, body) => response(body, 'KEY_LEFT', '1'),
    }).run({ ...config, goal: 'Play the game' });
    expect(result).toMatchObject({ status: 'blocked', steps: 0, modelCalls: 1 });
    expect(result.message).toContain('No game key was sent');
    expect(await tab.evaluate('window.keys')).toEqual([]);
    expect(await tab.locator('#search').inputValue()).toBe('keep this text');
  });
}, 15_000);

it.runIf(process.env.JEVRY_BROWSER_TEST === '1')('refreshes a failed game-focus preparation without replaying a move', async () => {
  await realFixture(gameFixture.replace(' tabindex="0"',''), async (browser,tab) => {
    const evaluate=browser.evaluate;let preparations=0,decisions=0;
    browser.evaluate=async<T>(expression:string):Promise<T>=>{
      const value=await evaluate<T>(expression);
      if(expression.startsWith('/* jev:prepare-game-key */')&&++preparations===1)throw new Error('Execution context changed before key dispatch');
      return value;
    };
    const result=await new AgentEngine(browser,()=>{},{
      infer:async(_,body)=>response(body,++decisions<=2?'KEY_LEFT':'DONE','1'),
    }).run({...config,goal:'Play the game'});
    expect(result).toMatchObject({status:'complete',steps:1});
    expect(preparations).toBe(2);
    expect(await tab.evaluate('window.keys')).toEqual(['ArrowLeft']);
    expect(await tab.locator('canvas').getAttribute('tabindex')).toBeNull();
  });
},15_000);

it.runIf(process.env.JEVRY_BROWSER_TEST === '1')('keeps board focus and layout stable between moves, restoring focusability once the run ends',async()=>{
  await realFixture(gameFixture.replace(' tabindex="0"',''),async(browser,tab)=>{
    await tab.evaluate(()=>{
      const canvas=document.querySelector('canvas')!;
      (window as any).focusCount=0;(window as any).focusChanges=[];
      canvas.addEventListener('focus',()=>{(window as any).focusCount++;});
      new MutationObserver(records=>{for(const record of records)if(record.attributeName==='tabindex')(window as any).focusChanges.push(canvas.getAttribute('tabindex'));}).observe(canvas,{attributes:true});
    });
    const initial=await tab.locator('canvas').boundingBox();let count=0;
    const result=await new AgentEngine(browser,()=>{},{infer:async(_,body)=>response(body,count++<8?'KEY_LEFT':'DONE','1')}).run({...config,goal:'Play eight moves'});
    expect(result).toMatchObject({status:'complete',steps:8});
    expect(await tab.evaluate('(window).focusCount')).toBe(1);
    expect(await tab.evaluate('(window).focusChanges')).toEqual(['-1',null]);
    expect(await tab.locator('canvas').boundingBox()).toEqual(initial);
    expect(await tab.locator('canvas').getAttribute('tabindex')).toBeNull();
  });
},15_000);

it.runIf(process.env.JEVRY_BROWSER_TEST === '1')('cancels before game dispatch and restores a canvas made focusable', async () => {
  await realFixture(gameFixture.replace(' tabindex="0"',''), async (browser,tab) => {
    const evaluate=browser.evaluate,controller=new AbortController();
    browser.evaluate=async<T>(expression:string):Promise<T>=>{
      const value=await evaluate<T>(expression);
      if(expression.startsWith('/* jev:prepare-game-key */'))controller.abort();
      return value;
    };
    const result=await new AgentEngine(browser,()=>{},{infer:async(_,body)=>response(body,'KEY_LEFT','1')}).run({...config,goal:'Play the game',signal:controller.signal});
    expect(result).toMatchObject({status:'stopped',steps:0});
    expect(await tab.evaluate('window.keys')).toEqual([]);
    expect(await tab.locator('canvas').getAttribute('tabindex')).toBeNull();
  });
},15_000);

it.runIf(process.env.JEVRY_BROWSER_TEST === '1').each(['keyDown','keyUp'])('never replays a game move after a %s transport failure', async failedPhase => {
  await realFixture(gameFixture.replace(' tabindex="0"',''), async (browser,tab) => {
    const cdp=browser.cdp,phases:string[]=[];
    browser.cdp=async(method,params)=>{
      const result=await cdp(method,params);
      if(method==='Input.dispatchKeyEvent') {
        phases.push(String(params?.type));
        if(params?.type===failedPhase)throw new Error('Transport interrupted after native dispatch');
      }
      return result;
    };
    const result=await new AgentEngine(browser,()=>{},{infer:async(_,body)=>response(body,'KEY_LEFT','1')}).run({...config,goal:'Play the game'});
    expect(result).toMatchObject({status:'error',modelCalls:1,steps:failedPhase==='keyUp'?1:0});
    expect(result.message).toContain('will not be replayed');
    expect(phases).toEqual(['keyDown','keyUp']);
    expect(await tab.evaluate('window.keys')).toEqual(['ArrowLeft']);
    expect(await tab.locator('canvas').getAttribute('tabindex')).toBeNull();
  });
},15_000);

it.runIf(process.env.JEVRY_BROWSER_TEST === '1')('stops bounded canvas input when no readable outcome ever changes', async () => {
  await realFixture('<html><body><canvas width="300" height="300"></canvas><p>Score 0</p></body></html>', async browser => {
    const result = await new AgentEngine(browser, () => {}, {
      infer: async (_, body) => response(body, 'KEY_LEFT', '1'),
    }).run({ ...config, goal: 'Play the game' });
    expect(result).toMatchObject({ status: 'blocked', steps: 12, modelCalls: 12, verified: false });
    expect(result.message).toContain('no score or other readable progress');
  });
}, 15_000);


it.runIf(process.env.JEVRY_BROWSER_TEST === '1')('lets Jev select the winning board click from locally grounded cell choices', async () => {
  const { readFile } = await import('node:fs/promises');
  await realFixture(await readFile('tests/games/three-in-a-row.html', 'utf8'), async (browser, tab) => {
    let visualCalls = 0, jevCalls = 0;
    const result = await new AgentEngine(browser, () => {}, {
      gameInfer: async (_config, prompt) => {
        visualCalls++;
        const context = JSON.parse(prompt.split('UNTRUSTED_CONTEXT: ')[1]);
        return JSON.stringify({ strategy: 'You are X; complete three in a row by clicking an empty cell.', observation: 'X at top left and center.', controls: ['pointer'],
          grid: { target: Object.keys(context.pointTargets)[0], rows: 3, columns: 3, bounds: { x:0,y:0,width:1,height:1 }, cells: [['X','O','empty'],['empty','X','O'],['empty','empty','empty']] } });
      },
      infer: async (_, body) => {
        jevCalls++;
        if ((body.state.page as {text:string}).text.includes('You win!')) return response(body,'DONE');
        expect(body.state.game).toMatchObject({board:{cells:[['X','O','empty'],['empty','X','O'],['empty','empty','empty']],unknown:0}});
        return response(body,'POINT','cell_3_3');
      },
      verifyOutcome: async p => p.text.includes('You win!'),
    }).run({...config,goal:'Win the game',gameMode:'win'});
    expect(result).toMatchObject({status:'complete',steps:1,verified:true,modelCalls:3});
    expect(visualCalls).toBe(1);expect(jevCalls).toBe(2);
    expect(await tab.locator('#status').innerText()).toBe('You win! Three Xs in a row.');
  });
},15000);

it.runIf(process.env.JEVRY_BROWSER_TEST === '1')('releases a held arcade key and retains its receipt when Stop interrupts input', async () => {
  await realFixture(gameFixture, async (browser,tab) => {
    await tab.evaluate(()=>{(window as any).released=[];document.addEventListener('keyup',e=>(window as any).released.push(e.key));});
    const controller=new AbortController(),original=browser.cdp;
    browser.cdp=async(method,params)=>{
      const result=await original(method,params);
      if(method==='Input.dispatchKeyEvent'&&params?.type==='keyDown')controller.abort();
      return result;
    };
    const evaluate=browser.evaluate;
    browser.evaluate=async<T>(expression:string):Promise<T>=>{
      const value=await evaluate<T>(expression);
      if(expression===READ_STATE)for(const a of (value as PageState).actions)if(a.kind==='key')a.holdMs=800;
      return value;
    };
    const result=await new AgentEngine(browser,()=>{},{
      infer:async(_,body)=>response(body,'KEY_LEFT','1'),
    }).run({...config,goal:'Play the game',signal:controller.signal});
    expect(result.status).toBe('stopped');
    expect(await tab.evaluate('(window).released')).toEqual(['ArrowLeft']);
    expect(await tab.evaluate('window.keys')).toEqual(['ArrowLeft']);
    expect(result.actions).toEqual([{action:'Game canvas → ArrowLeft',kind:'key',page_changed:null}]);
  });
},15000);
