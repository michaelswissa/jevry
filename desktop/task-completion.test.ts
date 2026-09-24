import {it,expect} from 'vitest';
import {completionRequest,selectedCompletionEvidenceStillPresent} from './task-completion';
import type {PageState} from './engine';
import type {ObservedPassage} from './observation-memory';
it('supplies observed field values and selections without presenting an unselected option as current',()=>{
 const page:PageState={url:'https://example.test',title:'Search',text:'Destination Guests Search',w:800,h:600,marker:[1],page_key:[1],guards:{},actions:[
   {id:'e1',node:1,kind:'fill',label:'Destination',value:'Paris'},
   {id:'e2',node:2,kind:'select',label:'Guests → 1 guest',value:'1',current_value:'2 guests'},
   {id:'e3',node:2,kind:'select',label:'Guests → 2 guests',value:'2',current_value:'2 guests'},
 ]};
 const request=completionRequest({success:['Destination is Paris and two guests are selected.'],constraints:[],progressOnly:[]},page,'Find stays','jev-latest');
 const evidence=Object.values(request.state.untrustedEvidence as Record<string,string>).join('\n');
 expect(evidence).toContain('Observed field Destination: current value "Paris"');
 expect(evidence).toContain('Observed selection Guests: current value "2 guests"');
 expect(evidence).not.toContain('1 guest');
});

it('checks full enumeration scope independently from a matching record citation',()=>{
 const page:PageState={url:'https://example.test/items',title:'Records',text:'12 records. Page 1 of 2. Next.',w:800,h:600,marker:[1],page_key:[1],guards:{},actions:[],collections:[{
  label:'Records',items:['Matches requested condition. Author: Taylor'],itemOrdinals:[1],totalItems:1,totalDomItems:1,truncated:false,
  source:{url:'https://example.test/items',tag:'ol',collectionOrdinal:1,collectionCount:1},
 }]};
 const request=completionRequest({success:['Retrieve the names of matching authors.'],constraints:[],progressOnly:[]},page,'Retrieve the names of matching authors.','jev-latest');
 const evidence=request.state.untrustedEvidence as Record<string,string>;
 expect(Object.values(evidence).join('\n')).toContain('Page 1 of 2. Next.');
 expect(Object.values(evidence).join('\n')).toContain('Author: Taylor');
 expect(Object.keys(request.questions.coverage.criteria)).toEqual(['COMPLETE','INCOMPLETE']);
 expect(request.questions.criterion_0.criteria).toHaveProperty('NOT_OBSERVED');
 expect(request.questions.coverage.instructions).toEqual({rule:expect.stringContaining('Finding some matching records does not establish that all matches were collected')});
 expect(JSON.stringify(request.questions.coverage)).toContain('DOM snapshot only');
 expect(JSON.stringify(request.questions.coverage)).toContain('Unrelated archived omissions');
});

it('offers explicit scoped empty-state evidence without inventing per-item facts or automatic success',()=>{
 const page:PageState={url:'https://example.test/messages',title:'Messages',text:'Messages matching this filter: No messages found.',w:800,h:600,marker:[1],page_key:[1],guards:{},actions:[],collections:[]};
 const request=completionRequest({success:['Determine how many matching messages have unread replies.'],constraints:[],progressOnly:[]},page,'Count matching messages with unread replies.','jev-latest');
 expect(Object.values(request.state.untrustedEvidence as Record<string,string>).join('\n')).toContain('No messages found.');
 expect(JSON.stringify(request.questions.criterion_0.instructions)).toContain('empty establishes a zero count and needs no per-item attributes');
 expect(Object.keys(request.questions.coverage.criteria)).toContain('INCOMPLETE');
 expect(request.state).not.toHaveProperty('count');
 expect(request.state).not.toHaveProperty('complete');
});

it('preserves prior collection provenance and omission flags and exposes current text truncation',()=>{
 const page:PageState={url:'https://example.test/detail',title:'Detail',text:'x'.repeat(12001),w:800,h:600,marker:[1],page_key:[1],guards:{},actions:[]};
 const prior={url:'https://example.test/list?order=recent',title:'Newest',text:'Record Author: Name',atAction:3,truncated:false,omittedPassages:2,collection:{source:{url:'https://example.test/list?order=recent',tag:'ol',collectionOrdinal:1,collectionCount:1},itemOrdinal:8,totalRenderedItems:10,totalDomItems:10,windowTruncated:true}};
 const request=completionRequest({success:['Read the record.'],constraints:[],progressOnly:[]},page,'Read the record.','jev-latest',[prior]);
 expect(request.state.evidenceLimits).toEqual({currentTextTruncated:true});
 expect((request.state.untrustedEvidence as Record<string,string>).prior_0).toContain(JSON.stringify(prior));
 expect(Object.keys(request.questions.criterion_0.criteria)).toContain('prior_0');
});

const gamePage=(text:string):PageState=>({url:'https://example.test/game',title:'Board',text,w:800,h:600,marker:[1],page_key:[1],guards:{},actions:[]});
const gameContract={success:['Queue one foundry in the selected town.'],constraints:[],progressOnly:[]};
const gameRequest=(text:string,observations:ObservedPassage[]=[])=>completionRequest(gameContract,gamePage(text),'Queue one foundry.','jev-latest',observations,{gameMode:true});
const evidenceOf=(request:ReturnType<typeof completionRequest>)=>request.state.untrustedEvidence as Record<string,string>;
const gameLines=(request:ReturnType<typeof completionRequest>)=>Object.entries(evidenceOf(request)).filter(([id])=>id.startsWith('line_')).map(([,text])=>text);

it('leaves the default completion request unchanged when game mode is not enabled',()=>{
 const page=gamePage('Next tick 00:08\nQueue: Foundry');
 const prior={url:page.url,title:page.title,text:'Queue button',atAction:2,truncated:false};
 const request=completionRequest(gameContract,page,'Queue one foundry.','jev-latest',[prior]);
 expect(request).toEqual(completionRequest(gameContract,page,'Queue one foundry.','jev-latest',[prior],{gameMode:false}));
 expect(evidenceOf(request)).toEqual({
  evidence_0:'Observed address: '+page.url,
  evidence_1:'Observed title: '+page.title,
  evidence_2:page.text,
  prior_0:'Earlier observed passage (retrieved facts only; NOT proof of current controls or saved changes): '+JSON.stringify(prior),
 });
 expect(request.state).not.toHaveProperty('archiveEvidenceRule');
 expect(request.state.evidenceLimits).toEqual({currentTextTruncated:false});
 expect(request.questions.coverage.instructions).toEqual({rule:expect.stringContaining('Never infer saved changes from earlier readings or attempted input.')});
 expect(JSON.stringify(request.questions.criterion_0.instructions)).not.toContain('visible text line');
});

it('preserves a complete stable line citation when only an unrelated countdown changes',()=>{
 const original=gameRequest('Next tick 00:08\nConstruction started: Foundry\nQueue: Foundry');
 const fresh=gameRequest('Next tick 00:07\nConstruction started: Foundry\nQueue: Foundry');
 const citation='Observed visible text line: Construction started: Foundry';
 expect(gameLines(original)).toContain(citation);
 expect(selectedCompletionEvidenceStillPresent([citation],fresh)).toBe(true);
 expect(selectedCompletionEvidenceStillPresent([evidenceOf(original).evidence_2],fresh)).toBe(false);
 // Evidence identifiers are not fact identities: lines may move in the DOM.
 expect(selectedCompletionEvidenceStillPresent([citation],gameRequest('Construction started: Foundry\nQueue: Foundry\nNext tick 00:06'))).toBe(true);
});

it('rejects removed or changed outcome facts, changed cited status, and partial citation matches',()=>{
 const result='Observed visible text line: Queue: Foundry';
 const status='Observed visible text line: Construction: 4%';
 const fresh=gameRequest('Next tick 00:07\nQueue: Foundry\nConstruction: 5%');
 expect(selectedCompletionEvidenceStillPresent([result],fresh)).toBe(true);
 expect(selectedCompletionEvidenceStillPresent([result,status],fresh)).toBe(false);
 expect(selectedCompletionEvidenceStillPresent([result],gameRequest('Queue: Granary'))).toBe(false);
 expect(selectedCompletionEvidenceStillPresent([result],gameRequest('No construction queued'))).toBe(false);
 expect(selectedCompletionEvidenceStillPresent(['Queue: Foundry'],fresh)).toBe(false);
 expect(selectedCompletionEvidenceStillPresent(['Observed visible text line: Queue: Found'],fresh)).toBe(false);
 expect(selectedCompletionEvidenceStillPresent([],fresh)).toBe(false);
 expect(selectedCompletionEvidenceStillPresent(['  '],fresh)).toBe(false);
 expect(selectedCompletionEvidenceStillPresent([result],{...fresh,state:{untrustedEvidence:[result]}})).toBe(false);
 expect(selectedCompletionEvidenceStillPresent([result],{...fresh,state:{}})).toBe(false);
});

it('offers only complete lines with original internal characters, deduplicated and count bounded',()=>{
 const request=gameRequest('  Construction: 4% → Foundry  \r\nConstruction: 4% → Foundry\n\n'+Array.from({length:70},(_,i)=>'Visible row '+i).join('\n'));
 const lines=gameLines(request);
 expect(lines[0]).toBe('Observed visible text line: Construction: 4% → Foundry');
 expect(lines.filter(line=>line.includes('4% → Foundry'))).toHaveLength(1);
 expect(lines).toHaveLength(64);
 expect(request.state.evidenceLimits).toEqual({currentTextTruncated:false,omittedGameTextLines:7});
 for(const [id,value]of Object.entries(evidenceOf(request)).filter(([id])=>id.startsWith('line_'))){
  expect(request.questions.criterion_0.criteria[id]).toEqual({evidence:'untrustedEvidence.'+id});
  expect(value.startsWith('Observed visible text line: ')).toBe(true);
 }
});

it('bounds line characters and skips oversized lines or lines crossing the current text cutoff',()=>{
 const request=gameRequest(Array.from({length:20},(_,i)=>String(i).padStart(2,'0')+'x'.repeat(498)).join('\n'));
 const lines=gameLines(request);
 expect(lines.reduce((total,line)=>total+line.length,0)).toBeLessThanOrEqual(8000);
 expect(lines.length).toBeLessThan(20);
 expect((request.state.evidenceLimits as {omittedGameTextLines:number}).omittedGameTextLines).toBeGreaterThan(0);
 const boundary=gameRequest('x'.repeat(11980)+'\nConstruction started: Foundry\nQueue: Foundry');
 expect(gameLines(boundary)).toEqual([]);
 expect(boundary.state.evidenceLimits).toEqual({currentTextTruncated:true,omittedGameTextLines:3});
 const oversized=gameRequest('x'.repeat(601)+'\nQueue: Foundry');
 expect(gameLines(oversized)).toEqual(['Observed visible text line: Queue: Foundry']);
 expect(oversized.state.evidenceLimits).toEqual({currentTextTruncated:false,omittedGameTextLines:1});
});

it('keeps added line choices within the model choice limit without dropping prior metadata',()=>{
 const priors=Array.from({length:250},(_,i)=>({url:'https://example.test/game',title:'Board',text:'Observed row '+i,atAction:i,truncated:false}));
 const request=gameRequest('Next tick 00:08\nQueue: Foundry',priors);
 expect(Object.keys(request.questions.criterion_0.criteria)).toHaveLength(255);
 expect(gameLines(request)).toHaveLength(1);
 expect(evidenceOf(request).prior_249).toContain(JSON.stringify(priors[249]));
 expect(request.state.evidenceLimits).toEqual({currentTextTruncated:false,omittedGameTextLines:1});
});

it('keeps explicit post-action confirmations with their observation order without treating attempted input as proof',()=>{
 const prior={url:'https://example.test/game',title:'Selected town',text:'Town: Lakeside\nConstruction started: Foundry',atAction:7,truncated:false};
 const request=gameRequest('Town panel closed',[prior]);
 expect(evidenceOf(request).prior_0).toContain(JSON.stringify(prior));
 expect(request.state.archiveEvidenceRule).toContain('explicit observed post-action outcome confirmations');
 expect(request.state.archiveEvidenceRule).toContain('target, outcome and atAction order match the request');
 expect(request.state.archiveEvidenceRule).toContain('not proof that an input succeeded');
 expect(request.state.archiveEvidenceRule).toContain('attempted inputs alone cannot prove a saved result or current control state');
 expect(request.state.archiveEvidenceRule).toContain('Later contradictory observations take precedence');
 expect(JSON.stringify(request.questions.coverage.instructions)).not.toContain('Never infer saved changes from earlier readings');
 expect(request.state).not.toHaveProperty('complete');
 expect(selectedCompletionEvidenceStillPresent([evidenceOf(request).prior_0],gameRequest('Town panel closed',[{...prior,atAction:8}]))).toBe(false);
});

it('offers an optional whole visual reading only in game mode, explicitly without independent verification',()=>{
 const page=gamePage('Town: Lakeside');
 const visualObservation='The selected town panel shows a Foundry I icon.\nThe construction queue is empty.';
 const ordinary=completionRequest(gameContract,page,'Inspect the foundry.','jev-latest');
 expect(completionRequest(gameContract,page,'Inspect the foundry.','jev-latest',[],{visualObservation})).toEqual(ordinary);
 expect(completionRequest(gameContract,page,'Inspect the foundry.','jev-latest',[],{gameMode:false,visualObservation})).toEqual(ordinary);
 const request=completionRequest(gameContract,page,'Inspect the foundry.','jev-latest',[],{gameMode:true,visualObservation});
 expect(evidenceOf(request).visual_observation).toBe('Current game screenshot reading by the visual model (not independently verified): '+visualObservation);
 expect(request.questions.criterion_0.criteria.visual_observation).toEqual({evidence:'untrustedEvidence.visual_observation'});
 expect(request.questions.criterion_0.criteria).toHaveProperty('NOT_OBSERVED');
 expect(request.questions.coverage).toEqual(gameRequest(page.text).questions.coverage);
 expect(request.state).not.toHaveProperty('complete');
 expect(evidenceOf(gameRequest(page.text))).not.toHaveProperty('visual_observation');
});

it('omits empty or oversized visual readings whole and accepts the exact size boundary',()=>{
 const page=gamePage('Town: Lakeside');
 const request=(visualObservation?:string)=>completionRequest(gameContract,page,'Inspect the foundry.','jev-latest',[],{gameMode:true,visualObservation});
 for(const visual of ['', ' \n\t ', 'x'.repeat(2001)])expect(request(visual)).toEqual(request());
 const visual='x'.repeat(2000);
 expect(evidenceOf(request(visual)).visual_observation).toBe('Current game screenshot reading by the visual model (not independently verified): '+visual);
 const priors=Array.from({length:250},(_,i)=>({url:page.url,title:page.title,text:'Observed row '+i,atAction:i,truncated:false}));
 const bounded=completionRequest(gameContract,page,'Inspect the foundry.','jev-latest',priors,{gameMode:true,visualObservation:'A Foundry I icon is visible.'});
 expect(Object.keys(bounded.questions.criterion_0.criteria)).toHaveLength(255);
 expect(evidenceOf(bounded)).toHaveProperty('visual_observation');
 expect(gameLines(bounded)).toEqual([]);
});

it('requires a selected visual citation to remain exactly present after a fresh evidence rebuild',()=>{
 const request=(visualObservation?:string)=>completionRequest(gameContract,gamePage('Town: Lakeside'),'Inspect the foundry.','jev-latest',[],{gameMode:true,visualObservation});
 const visual='A Foundry I icon is visible in the selected town panel.';
 const citation=evidenceOf(request(visual)).visual_observation;
 expect(selectedCompletionEvidenceStillPresent([citation],request(visual))).toBe(true);
 expect(selectedCompletionEvidenceStillPresent([citation],request())).toBe(false);
 expect(selectedCompletionEvidenceStillPresent([citation],request('No Foundry I icon is visible in the selected town panel.'))).toBe(false);
 expect(selectedCompletionEvidenceStillPresent([citation],request(visual+' The icon is greyed out.'))).toBe(false);
 expect(selectedCompletionEvidenceStillPresent([visual],request(visual))).toBe(false);
});
