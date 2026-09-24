import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {mkdtemp,readFile,writeFile,rm,stat,readdir} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {ConversationSnapshot} from '../src/conversation-types';

const mock=vi.hoisted(()=>({directory:'',available:true,decryptFailure:false,readFailure:'',writeFailure:false,renameFailure:false,
  read:vi.fn(),write:vi.fn(),rename:vi.fn(),encrypt:vi.fn(),decrypt:vi.fn()}));
vi.mock('electron',()=>({app:{getPath:(name:string)=>{if(name!=='userData')throw new Error('Unexpected application path');return mock.directory;}},safeStorage:{
  isEncryptionAvailable:()=>mock.available,
  encryptString:mock.encrypt.mockImplementation((value:string)=>Buffer.from('fixture-envelope:'+Buffer.from(value).toString('base64'))),
  decryptString:mock.decrypt.mockImplementation((value:Buffer)=>{
    if(mock.decryptFailure)throw Object.assign(new Error('Fixture decryption failed'),{code:'ENOENT'});
    if(!value.toString().startsWith('fixture-envelope:'))throw new Error('Invalid fixture ciphertext');
    return Buffer.from(value.toString().slice('fixture-envelope:'.length),'base64').toString();
  }),
}}));
vi.mock('node:fs',async importOriginal=>{
  const actual=await importOriginal<typeof import('node:fs')>();
  return {...actual,
    readFileSync:mock.read.mockImplementation((file:string,...args:any[])=>{
      if(file===mock.readFailure)throw Object.assign(new Error('Fixture file access denied'),{code:'EACCES'});
      return (actual.readFileSync as any)(file,...args);
    }),
    writeFileSync:mock.write.mockImplementation((file:string,data:Buffer,...args:any[])=>{
      if(mock.writeFailure){actual.writeFileSync(file,Buffer.from('PARTIAL TEMPORARY WRITE'));throw new Error('Fixture disk full');}
      return (actual.writeFileSync as any)(file,data,...args);
    }),
    renameSync:mock.rename.mockImplementation((from:string,to:string)=>{
      if(mock.renameFailure)throw new Error('Fixture rename denied');
      actual.renameSync(from,to);
    }),
  };
});
import {Store,type Workspace} from './store';

const encode=(value:unknown)=>Buffer.from('fixture-envelope:'+Buffer.from(JSON.stringify(value)).toString('base64'));
const encodedText=(text:string)=>Buffer.from('fixture-envelope:'+Buffer.from(text).toString('base64'));
const file=(name:string)=>join(mock.directory,name);
const workspace:Workspace={tabs:[{id:'first',url:'https://example.test/page'},{id:'blank',url:'about:blank'}],activeTabId:'first'};
const connections={text:{provider:'claude' as const,model:'fixture-model'},jev:{apiKey:'fixture-key',model:'jev-fixture',baseUrl:'https://fixture.test'},onboardingComplete:true,reducedEffects:true};
beforeEach(async()=>{
  mock.directory=await mkdtemp(join(tmpdir(),'jevry-store-test-'));
  mock.available=true;mock.decryptFailure=false;mock.readFailure='';mock.writeFailure=false;mock.renameFailure=false;
  for(const fn of [mock.read,mock.write,mock.rename,mock.encrypt,mock.decrypt])fn.mockClear();
});
afterEach(async()=>{await rm(mock.directory,{recursive:true,force:true});});

describe('connection and workspace archive protection',()=>{
  it('allows missing archives to be created and valid records to round trip',async()=>{
    const store=new Store();
    expect(store.connectionError).toBeUndefined();expect(store.text).toBeUndefined();
    expect(store.loadWorkspace()).toEqual({tabs:[],activeTabId:null});expect(store.workspaceError).toBeUndefined();
    store.set(connections);store.saveWorkspace(workspace);
    expect((await readFile(file('connections.enc'))).toString()).not.toContain('fixture-key');
    expect((await readFile(file('workspace.enc'))).toString()).not.toContain('example.test');
    const reopened=new Store();
    expect(reopened.text).toEqual(connections.text);expect(reopened.jev).toEqual(connections.jev);
    expect(reopened.public()).toMatchObject({text:{connected:true,provider:'claude'},jev:{connected:true},onboardingComplete:true,reducedEffects:true});
    expect(JSON.stringify(reopened.public())).not.toContain('fixture-key');
    expect(reopened.loadWorkspace()).toEqual(workspace);
    expect(await readdir(mock.directory)).toEqual(expect.arrayContaining(['connections.enc','workspace.enc']));
    expect((await readdir(mock.directory)).some(name=>name.endsWith('.tmp'))).toBe(false);
    if(process.platform!=='win32')expect((await stat(file('connections.enc'))).mode&0o777).toBe(0o600);
  });

  it.each(['corrupt-ciphertext','invalid-json','invalid-record','decrypt-failure','read-failure','credential-store-locked'])('preserves connection bytes after %s and blocks reconnect/disconnect',async failure=>{
    const original=failure==='corrupt-ciphertext'?Buffer.from('NOT AN ENCRYPTED ARCHIVE'):failure==='invalid-json'?encodedText('{broken'):failure==='invalid-record'?encode({text:{provider:'not-a-provider'}}):encode(connections);
    await writeFile(file('connections.enc'),original);
    mock.decryptFailure=failure==='decrypt-failure';mock.available=failure!=='credential-store-locked';if(failure==='read-failure')mock.readFailure=file('connections.enc');
    const store=new Store();
    expect(store.connectionError).toContain('connections.enc');expect(store.connectionError).toContain('preserved');expect(store.connectionError).toContain('restart');
    expect(store.text).toBeUndefined();expect(store.jev).toBeUndefined();
    mock.available=true;mock.decryptFailure=false;mock.readFailure='';
    expect(()=>store.set({text:{provider:'openai',apiKey:'replacement-fixture-key'}})).toThrow('replacement saves are blocked');
    expect(()=>store.disconnect('text')).toThrow('preserved');
    expect(await readFile(file('connections.enc'))).toEqual(original);
    expect(mock.write).not.toHaveBeenCalled();expect(mock.rename).not.toHaveBeenCalled();
  });

  it.each(['corrupt-ciphertext','invalid-json','invalid-record','decrypt-failure','read-failure','credential-store-locked'])('preserves workspace bytes after %s and blocks replacement saves',async failure=>{
    const original=failure==='corrupt-ciphertext'?Buffer.from('NOT AN ENCRYPTED ARCHIVE'):failure==='invalid-json'?encodedText('{broken'):failure==='invalid-record'?encode({tabs:[{id:'existing',url:42}]}):encode(workspace);
    await writeFile(file('workspace.enc'),original);
    const store=new Store();mock.decryptFailure=failure==='decrypt-failure';mock.available=failure!=='credential-store-locked';if(failure==='read-failure')mock.readFailure=file('workspace.enc');
    expect(store.loadWorkspace()).toEqual({tabs:[],activeTabId:null});
    expect(store.workspaceError).toContain('workspace.enc');expect(store.workspaceError).toContain('preserved');expect(store.workspaceError).toContain('restart');
    mock.available=true;mock.decryptFailure=false;mock.readFailure='';
    expect(()=>store.saveWorkspace({tabs:[],activeTabId:null})).toThrow('replacement saves are blocked');
    expect(await readFile(file('workspace.enc'))).toEqual(original);
    expect(mock.write).not.toHaveBeenCalled();expect(mock.rename).not.toHaveBeenCalled();
  });

  it('checks a pre-existing workspace before the first save even if load was not called',async()=>{
    const original=encodedText('not JSON');await writeFile(file('workspace.enc'),original);
    const store=new Store();expect(()=>store.saveWorkspace(workspace)).toThrow('preserved');
    expect(await readFile(file('workspace.enc'))).toEqual(original);expect(mock.write).not.toHaveBeenCalled();
  });

  it.each([
    {tabs:[{id:'same',url:'https://first.test'},{id:'same',url:'https://second.test'}]},
    {tabs:[{id:'page',url:'javascript:alert(1)'}]},
    {tabs:[{id:'page',url:'not a URL'}]},
    {tabs:[] ,activeTabId:12},
    {tabs:Array.from({length:65},(_,i)=>({id:String(i),url:'https://fixture.test'}))},
  ])('protects invalid or oversized workspace records instead of silently pruning them',async value=>{
    const original=encode(value);await writeFile(file('workspace.enc'),original);
    const store=new Store();store.loadWorkspace();expect(store.workspaceError).toContain('preserved');
    expect(()=>store.saveWorkspace(workspace)).toThrow('preserved');expect(await readFile(file('workspace.enc'))).toEqual(original);
  });

  it('keeps recovery explicit across a reload and allows an independently repaired archive after restart',async()=>{
    await writeFile(file('connections.enc'),encodedText('bad'));await writeFile(file('workspace.enc'),encodedText('bad'));
    const locked=new Store();locked.loadWorkspace();
    // Simulate an explicit user backup/restore, never a Store reset operation.
    await writeFile(file('connections.enc'),encode(connections));await writeFile(file('workspace.enc'),encode(workspace));
    expect(()=>locked.set({reducedEffects:false})).toThrow('preserved');
    expect(locked.loadWorkspace()).toEqual(workspace);expect(()=>locked.saveWorkspace(workspace)).toThrow('preserved');
    const reopened=new Store();expect(reopened.connectionError).toBeUndefined();expect(reopened.loadWorkspace()).toEqual(workspace);expect(reopened.workspaceError).toBeUndefined();
    reopened.set({reducedEffects:false});reopened.saveWorkspace(workspace);
  });

  it('reports unavailable encryption for new archives without writing plaintext or temp files',()=>{
    mock.available=false;const store=new Store();
    expect(store.connectionError).toBeUndefined();expect(store.loadWorkspace()).toEqual({tabs:[],activeTabId:null});expect(store.workspaceError).toBeUndefined();
    expect(()=>store.set(connections)).toThrow('credential store');expect(()=>store.saveWorkspace(workspace)).toThrow('credential store');
    expect(mock.encrypt).not.toHaveBeenCalled();expect(mock.write).not.toHaveBeenCalled();
  });

  it('rejects invalid new records before replacing readable archives',async()=>{
    const connectionBytes=encode(connections),workspaceBytes=encode(workspace);
    await writeFile(file('connections.enc'),connectionBytes);await writeFile(file('workspace.enc'),workspaceBytes);
    const store=new Store();store.loadWorkspace();
    expect(()=>store.set({text:{provider:'invalid' as any}})).toThrow('connection settings are invalid');
    expect(()=>store.saveWorkspace({tabs:[{id:'bad',url:'javascript:alert(1)'}],activeTabId:'bad'})).toThrow('unsupported tab URL');
    expect(()=>store.saveWorkspace({tabs:Array.from({length:65},(_,i)=>({id:String(i),url:'https://fixture.test'})),activeTabId:'0'})).toThrow('64 saved tabs');
    expect(store.text).toEqual(connections.text);expect(mock.write).not.toHaveBeenCalled();
    expect(await readFile(file('connections.enc'))).toEqual(connectionBytes);expect(await readFile(file('workspace.enc'))).toEqual(workspaceBytes);
  });

  it.each(['validation','encryption','write','rename'])('surfaces a recoverable workspace %s error and clears it only after a successful save',async failure=>{
    const original=encode(workspace);await writeFile(file('workspace.enc'),original);
    const store=new Store();store.loadWorkspace();
    mock.available=failure!=='encryption';mock.writeFailure=failure==='write';mock.renameFailure=failure==='rename';
    const next=failure==='validation'?{tabs:Array.from({length:65},(_,i)=>({id:String(i),url:'https://fixture.test'})),activeTabId:'0'}:workspace;
    expect(()=>store.saveWorkspace(next)).toThrow('Workspace tabs could not be saved');
    expect(store.workspaceError).toContain('Your open tabs remain available');
    if(failure==='validation')expect(store.workspaceError).toContain('64 saved tabs');
    expect(await readFile(file('workspace.enc'))).toEqual(original);
    mock.available=true;mock.writeFailure=false;mock.renameFailure=false;
    expect(store.loadWorkspace()).toEqual(workspace);expect(store.workspaceError).toBeDefined();
    store.saveWorkspace({...workspace,activeTabId:'blank'});expect(store.workspaceError).toBeUndefined();
    expect(new Store().loadWorkspace().activeTabId).toBe('blank');
  });

  it('replaces each archive only by renaming a complete encrypted temporary file',async()=>{
    await writeFile(file('connections.enc'),encode(connections));await writeFile(file('workspace.enc'),encode(workspace));
    const originals=new Map([['connections.enc',await readFile(file('connections.enc'))],['workspace.enc',await readFile(file('workspace.enc'))]]);
    const store=new Store();store.loadWorkspace();
    const rename=mock.rename.getMockImplementation()!;
    mock.rename.mockImplementationOnce((from:string,to:string)=>{
      expect(from).toBe(file('connections.enc.tmp'));expect(to).toBe(file('connections.enc'));
      expect(readFileSync(to)).toEqual(originals.get('connections.enc'));
      expect(readFileSync(from)).toEqual(encode({...connections,reducedEffects:false}));rename(from,to);
    });
    store.set({reducedEffects:false});
    mock.rename.mockImplementationOnce((from:string,to:string)=>{
      expect(from).toBe(file('workspace.enc.tmp'));expect(to).toBe(file('workspace.enc'));
      expect(readFileSync(to)).toEqual(originals.get('workspace.enc'));
      expect(readFileSync(from)).toEqual(encode({...workspace,activeTabId:'blank'}));rename(from,to);
    });
    store.saveWorkspace({...workspace,activeTabId:'blank'});
    expect(mock.rename).toHaveBeenCalledTimes(2);
    expect(mock.write.mock.calls.every(call=>call[2]?.mode===0o600)).toBe(true);
  });

  it.each(['write','rename'])('preserves old bytes and connection state when atomic %s fails',async failure=>{
    const connectionBytes=encode(connections),workspaceBytes=encode(workspace);
    await writeFile(file('connections.enc'),connectionBytes);await writeFile(file('workspace.enc'),workspaceBytes);
    const store=new Store();store.loadWorkspace();
    mock.writeFailure=failure==='write';mock.renameFailure=failure==='rename';
    expect(()=>store.set({text:{provider:'openai',apiKey:'replacement-fixture-key'}})).toThrow('Fixture');
    expect(()=>store.saveWorkspace({tabs:[],activeTabId:null})).toThrow('Fixture');
    expect(store.text).toEqual(connections.text);expect(await readFile(file('connections.enc'))).toEqual(connectionBytes);expect(await readFile(file('workspace.enc'))).toEqual(workspaceBytes);
  });
});

describe('preserve unreadable conversation archives',()=>{
  it('allows a first-launch archive to be created and reopened',()=>{
    const store=new Store();const snapshot=store.loadConversations();expect(store.historyError).toBeUndefined();store.saveConversations(snapshot);
    expect(new Store().loadConversations()).toEqual(snapshot);expect(mock.write).toHaveBeenCalledOnce();
  });
  it.each(['not valid JSON',JSON.stringify({conversations:[{id:'c',messages:null}]}),JSON.stringify({conversations:[{id:'c',title:'saved',memory:'',messages:[{role:'assistant',content:null}]}]})])('blocks writes after an invalid existing conversation archive',async content=>{
    const original=encodedText(content);await writeFile(file('conversations.enc'),original);
    const store=new Store(),snapshot:ConversationSnapshot=store.loadConversations();
    expect(store.historyError).toContain('preserved');expect(()=>store.saveConversations(snapshot)).toThrow('preserved');expect(mock.write).not.toHaveBeenCalled();expect(await readFile(file('conversations.enc'))).toEqual(original);
  });
});
