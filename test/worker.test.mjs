import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const code=await readFile(new URL('../extension/worker.js',import.meta.url),'utf8');
function harness(options={}){
  const calls={created:[],removed:[],reloaded:[],reports:[],cleared:[],tracked:[],windows:[],closedWindows:[]},listeners={};
  const storage={token:'a'.repeat(64),enabled:true};const tabs=new Map();let nextId=1;
  const access=(id,stage)=>{const tab=tabs.get(id);if(tab&&options.dropTab?.(tab,stage))tabs.delete(id);if(!tabs.has(id))throw Error(`No tab with id: ${id}.`);return tabs.get(id);};
  const event=name=>({addListener:fn=>listeners[name]=fn});
  const chrome={
    windows:{create:async input=>{calls.windows.push(input);return{id:77};},remove:async id=>{calls.closedWindows.push(id);}},
    storage:{local:{get:async()=>({...storage}),set:async value=>{Object.assign(storage,value);if(value.ownedTabs)calls.tracked.push([...value.ownedTabs]);}}},
    alarms:{clear:async name=>{calls.cleared.push(name);return true;},create:async()=>{},onAlarm:event('alarm')},
    runtime:{id:'local-extension',onStartup:event('startup'),onInstalled:event('installed'),onMessage:event('message')},
    tabs:{
      create:async input=>{const tab={id:nextId++,url:input.url,status:'complete'};tabs.set(tab.id,tab);calls.created.push(input);return tab;},
      get:async id=>access(id,'get'),update:async(id,input)=>Object.assign(access(id,input.url?'navigate':'configure'),input),
      reload:async id=>{calls.reloaded.push(id);if(options.onReload)options.onReload(tabs.get(id));},
      remove:async id=>{calls.removed.push(id);tabs.delete(id);},
      sendMessage:async(id,message)=>{const tab=access(id,message.stage);if(options.beforeProbe)await options.beforeProbe(tab.url,message.stage);if(tab.url.includes('platform.claude.com')&&message.stage==='usage')return options.billingProbe?options.billingProbe(tab):{identity:{kind:'console-label',value:'Demo User / Example Workspace'},balance:{currency:'USD',purchased:'0.00',promotional:[]},observedAt:new Date().toISOString()};if(message.stage==='identity'&&tab.url.includes('claude.ai')&&options.identityProbe)return options.identityProbe(tab);return message.stage==='identity'?{identity:{kind:'email',value:'fixture@example.com'}}:{identity:{kind:'email',value:'fixture@example.com'},metrics:[{window:'Weekly',used:10}],observedAt:new Date().toISOString()};},
    },
  };
  vm.runInNewContext(code,{chrome,crypto:globalThis.crypto,importScripts:()=>{},connectDesktop:async()=>{},disconnectDesktop:()=>{},fetch:async(url,input)=>{if(url.endsWith('/collector'))return{ok:!options.failHide};const body=JSON.parse(input.body);calls.reports.push(body);return{ok:!(body.status==='ok'&&body.provider===options.failReport)};},AbortSignal,URL,setTimeout:fn=>setTimeout(fn,0),Promise,Date});
  const send=(message,sender={id:'local-extension',tab:{id:99},url:'http://127.0.0.1:4317/'})=>new Promise(resolve=>{const keep=listeners.message(message,sender,resolve);if(!keep)resolve(undefined);});
  return {calls,listeners,storage,send};
}
test('worker startup and old five-minute alarms only remove schedule, never collect',async()=>{
  const h=harness();await h.listeners.startup();await h.listeners.alarm({name:'headroom'});
  assert.equal(h.calls.created.length,0);assert.equal(h.calls.reports.length,0);assert.ok(h.calls.cleared.length>=3);
});
test('local dashboard refresh collects four providers in inactive temporary tabs and closes them',async()=>{
  const h=harness();const result=await h.send({type:'refresh'});
  assert.equal(result.ok,true);assert.equal(result.completed,4);
  assert.equal(h.calls.created.length,4);assert.ok(h.calls.created.every(tab=>tab.active===false));assert.equal(h.calls.removed.length,4);
  assert.equal(h.calls.reports.filter(r=>r.status==='ok').length,4);
  assert.ok(h.calls.created.every(tab=>tab.windowId===77));
  assert.equal(h.calls.windows[0].state,'minimized');assert.equal(h.calls.windows[0].focused,false);
  assert.deepEqual(h.calls.closedWindows,[77]);
});

test('failure to hide the collector stops before any provider page opens and cleans up the window',async()=>{
  const h=harness({failHide:true});const result=await h.send({type:'refresh'});
  assert.ok(result.error);assert.equal(h.calls.created.length,0);assert.deepEqual(h.calls.closedWindows,[77]);
});
test('Claude identity timeout retries once in a fresh tab and uses only its new identity',async()=>{
  let first;
  const h=harness({identityProbe:tab=>{first??=tab.id;return tab.id===first?{}:{identity:{kind:'organization',value:'12345678-1234-1234-1234-123456789012'}};}});
  const result=await h.send({type:'refresh'});
  assert.equal(result.ok,true);assert.equal(h.calls.created.length,5);
  assert.equal(h.calls.reports.find(r=>r.provider==='anthropic'&&r.status==='ok').identity.kind,'organization');
  assert.equal(h.storage.ownedTabs.length,0);
});

test('billing waits for visible identity when balance loads first',async()=>{
  let attempts=0;
  const h=harness({billingProbe:()=>({identity:++attempts<3?null:{kind:'console-label',value:'Demo User / Example Workspace'},balance:{currency:'USD',purchased:'0.00',promotional:[]},observedAt:new Date().toISOString()})});
  const result=await h.send({type:'refresh'});
  assert.equal(result.ok,true);assert.equal(attempts,3);
  assert.equal(h.calls.reports.filter(r=>r.provider==='claude-api'&&r.status==='ok').length,1);
});

for (const stage of ['configure','usage']) test(`billing tab disappearing during ${stage} is replaced with a new inactive tab`,async()=>{
  let dropped=false;
  const h=harness({dropTab:(tab,operation)=>{if(!dropped&&tab.url.includes('platform.claude.com')&&operation===stage){dropped=true;return true;}return false;}});
  const result=await h.send({type:'refresh'});
  assert.equal(result.ok,true);assert.equal(h.calls.created.length,5);
  assert.ok(h.calls.created.every(tab=>tab.active===false));assert.equal(h.storage.ownedTabs.length,0);
  assert.equal(h.calls.reports.filter(r=>r.provider==='claude-api'&&r.status==='ok').length,1);
});

test('a lost Claude usage tab restarts identity lookup instead of reusing another tab identity',async()=>{
  let dropped=false,identities=0;
  const h=harness({dropTab:(tab,stage)=>{if(!dropped&&tab.url.includes('claude.ai')&&stage==='usage'){dropped=true;return true;}return false;},beforeProbe:async(url,stage)=>{if(url.includes('claude.ai')&&stage==='identity')identities++;}});
  assert.equal((await h.send({type:'refresh'})).ok,true);assert.equal(identities,2);assert.equal(h.storage.ownedTabs.length,0);
});

test('repeatedly closed billing tabs stop after one replacement and do not block other providers',async()=>{
  const h=harness({dropTab:(tab,stage)=>tab.url.includes('platform.claude.com')&&stage==='configure'});
  const result=await h.send({type:'refresh'});
  assert.equal(result.completed,3);assert.equal(h.calls.created.length,5);assert.equal(h.storage.ownedTabs.length,0);
  assert.equal(h.calls.reports.find(r=>r.provider==='claude-api'&&r.status==='error').errorCode,'tab-closed');
});

test('missing billing receiver recovers by replacing only its owned inactive tab once',async()=>{
  let firstId;
  const h=harness({billingProbe:tab=>{firstId??=tab.id;if(tab.id===firstId)throw Error('Could not establish connection. Receiving end does not exist.');return {identity:{kind:'console-label',value:'Fixture / Workspace'},balance:{currency:'USD',purchased:'0.00',promotional:[]},observedAt:new Date().toISOString()};}});
  const result=await h.send({type:'refresh'});
  assert.equal(result.ok,true);assert.equal(h.calls.reloaded.length,0);
  assert.ok(h.calls.removed.includes(firstId));assert.equal(h.calls.created.length,5);assert.ok(!h.calls.removed.includes(99));
});

test('permanently unavailable billing receiver stops after one recovery and preserves other providers',async()=>{
  const h=harness({billingProbe:()=>{throw Error('Receiving end does not exist.');}});
  const result=await h.send({type:'refresh'});
  assert.equal(result.ok,false);assert.equal(result.completed,3);assert.equal(h.calls.created.length,5);assert.equal(h.calls.reloaded.length,0);assert.equal(h.calls.removed.length,5);
  assert.equal(h.calls.reports.find(r=>r.provider==='claude-api'&&r.status==='error').errorCode,'script-unavailable');
});
test('foreign tab and disabled extension cannot trigger collection',async()=>{
  const h=harness();assert.equal(await h.send({type:'refresh'},{id:'local-extension',tab:{id:1},url:'https://example.com/'}),undefined);
  h.storage.enabled=false;assert.match((await h.send({type:'refresh'})).error,/暂停/);assert.equal(h.calls.created.length,0);
});

test('slow Claude does not delay Grok/Gemini reports; concurrent tabs are tracked without lost IDs',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve);
  const h=harness({beforeProbe:async(url,stage)=>{if(url.includes('claude.ai')&&stage==='usage')await gate;}});
  const run=h.send({type:'refresh'});
  for(let i=0;i<100 && h.calls.reports.filter(r=>r.status==='ok').length<3;i++)await new Promise(r=>setTimeout(r,1));
  try{
    assert.equal(h.calls.created.length,4);
    assert.deepEqual(h.calls.reports.filter(r=>r.status==='ok').map(r=>r.provider).sort(),['claude-api','google','xai']);
    assert.ok(h.calls.tracked.some(ids=>ids.length===4));
  }finally{release();}
  assert.equal((await run).completed,4);assert.equal(h.storage.ownedTabs.length,0);
});

test('one failed provider does not discard the other parallel results or leak temporary tabs',async()=>{
  const h=harness({failReport:'xai'});const result=await h.send({type:'refresh'},{id:'local-extension',tab:{id:99},url:'http://127.0.0.1:4317/toolbar'});
  assert.equal(result.completed,3);assert.equal(result.ok,false);assert.equal(h.calls.removed.length,4);assert.equal(h.storage.ownedTabs.length,0);
  assert.ok(h.calls.reports.some(r=>r.provider==='xai'&&r.status==='error'));
});
