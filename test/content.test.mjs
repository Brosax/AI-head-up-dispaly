import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../extension/content.js',import.meta.url),'utf8');
function harness(hostname,pathname) {
  let listener,reads=0;
  const location={hostname,pathname,search:'',hash:''};
  const extract=()=>{reads++;return {balance:true,metrics:[{used:0}],observedAt:'fixture'};};
  const identity=()=>{reads++;return {kind:'fixture',value:'fixture'};};
  vm.runInNewContext(source,{location,document:{},URLSearchParams,
    chrome:{runtime:{id:'headroom',onMessage:{addListener:fn=>listener=fn}}},
    HeadroomClaudeApi:{extract,identity:()=>{throw Error('Account menu is not rendered');}},HeadroomParser:{extract,identity}});
  return {location,get reads(){return reads;},probe(stage,sender={id:'headroom'}){let result;listener({type:'headroom-probe',stage},sender,value=>result=value);return result;}};
}

test('early Console listener reads nothing on landing page, then works after SPA billing navigation',()=>{
  const page=harness('platform.claude.com','/dashboard');
  assert.equal(page.probe('usage').error,'wrong-page');assert.equal(page.reads,0);
  page.location.pathname='/settings/billing';
  const result=page.probe('usage');
  assert.ok(result.balance);assert.equal(result.identity.kind,'console-view');assert.equal(result.identity.value,'current');assert.equal(page.reads,1);
});

test('Claude listener never reads conversations, and handles settings after SPA navigation',()=>{
  const page=harness('claude.ai','/chat/example');
  assert.equal(page.probe('usage').error,'wrong-page');assert.equal(page.reads,0);
  page.location.pathname='/new';page.location.hash='#settings/usage';
  assert.equal(page.probe('usage').metrics[0].used,0);assert.equal(page.reads,1);
});

test('Console ignores other extensions and non-billing account pages',()=>{
  const page=harness('platform.claude.com','/settings/billing');
  assert.equal(page.probe('usage',{id:'other'}),undefined);assert.equal(page.reads,0);
  page.location.pathname='/settings/organization';
  assert.equal(page.probe('identity').error,'wrong-page');assert.equal(page.reads,0);
});
