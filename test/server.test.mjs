import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { once } from 'node:events';

let child, directory, base;
before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'headroom-test-'));
  const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server.mjs'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), HEADROOM_DATA_DIR: directory }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(() => { throw new Error('Test server exited'); }), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Server startup timeout')), 10000); timer.unref(); })]);
});
after(async () => {
  if (child && child.exitCode === null) { const exit = once(child, 'exit'); child.kill(); await exit; }
  // Only remove the exact disposable directory created by this test, directly within OS temp.
  if (directory && path.dirname(path.resolve(directory)) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith('headroom-test-')) await rm(directory, { recursive: true, force: true });
});
const post = (route, body, headers = {}) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Headroom-Client': 'local', ...headers }, body: JSON.stringify(body) });

test('collector window endpoint requires pairing and validates the exact identifier',async()=>{
  const route='/api/browser/collector',origin='chrome-extension://'+'a'.repeat(32);
  assert.equal((await post(route,{id:'a'.repeat(32)})).status,403);
  assert.equal((await post(route,{id:'a'.repeat(32)},{Origin:origin})).status,401);
  const {key}=await (await post('/api/browser/pairing',{})).json();
  const headers={Origin:origin,Authorization:`Bearer ${key}`};
  assert.equal((await post(route,{id:'../arbitrary'},headers)).status,400);
  assert.equal((await post(route,{id:'a'.repeat(32),command:'other'},headers)).status,400);
  assert.equal((await fetch(base+'/collector?id=%3Cscript%3E')).status,400);
  const page=await fetch(base+'/collector?id='+'a'.repeat(32));
  assert.equal(page.status,200);assert.match(await page.text(),/AIHUD-Collector-a{32}/);
});

test('empty installation exposes four subscriptions and zero fabricated quotas', async () => {
  const data = await (await fetch(base + '/api/dashboard')).json();
  assert.equal(data.providers.length, 4); assert.equal(data.pools.length, 0); assert.equal(data.stats.fresh, 0);
});
test('cross-origin writes and writes without a local client header are rejected', async () => {
  assert.equal((await post('/api/manual', {}, { Origin: 'https://example.com' })).status, 403);
  const response = await fetch(base + '/api/manual', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 403);
});
test('manual quota persists and explicit web update does not add a duplicate pool', async () => {
  const first = await post('/api/manual', { provider: 'google', accountLabel: 'test-only', scopeLabel: 'Gemini Apps', window: 'Weekly', remaining: 75 });
  assert.equal(first.status, 200); const created = await first.json(); const poolId = created.pools[0].poolId;
  const update = await post('/api/manual', { provider: 'google', targetPoolId: poolId, remaining: 72, confirmShared: true });
  assert.equal(update.status, 200); const updated = await update.json();
  assert.equal(updated.pools.length, 1); assert.equal(updated.pools[0].remaining, 72);
  const saved = JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8'));
  assert.ok(saved.observations.length >= 1); assert.equal(saved.observations.at(-1).remaining, 72);
});
test('invalid input cannot corrupt persisted state', async () => {
  const before = await readFile(path.join(directory, 'state.json'), 'utf8');
  const response = await post('/api/import', { data: { tokens: 1000 }, observedAt: new Date().toISOString() });
  assert.equal(response.status, 400); assert.equal(await readFile(path.join(directory, 'state.json'), 'utf8'), before);
});
test('static allowlist protects local files and sends a restrictive script policy', async () => {
  assert.equal((await fetch(base + '/data/state.json')).status, 404);
  assert.equal((await fetch(base + '/local-config.json')).status, 404);
  const page = await fetch(base + '/'); assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
});

test('browser bridge requires extension origin AND secret, and cannot expose pairing or dashboard',async()=>{
  const origin='chrome-extension://'+'a'.repeat(32);
  const keyResult=await post('/api/browser/pairing',{});assert.equal(keyResult.status,200);const {key}=await keyResult.json();
  const payload={provider:'google',status:'ok',identity:{kind:'email',value:'bridge@example.com'},observedAt:new Date().toISOString(),metrics:[{window:'Weekly',used:20,resetsAt:null}]};
  assert.equal((await post('/api/browser/report',payload,{Origin:origin})).status,401);
  assert.equal((await post('/api/browser/report',payload,{Origin:'https://example.com',Authorization:`Bearer ${key}`})).status,403);
  assert.equal((await post('/api/browser/pairing',{}, {Origin:origin,Authorization:`Bearer ${key}`})).status,403);
  assert.equal((await fetch(base+'/api/dashboard',{headers:{Origin:origin,Authorization:`Bearer ${key}`}})).status,403);
  const valid=await post('/api/browser/report',payload,{Origin:origin,Authorization:`Bearer ${key}`});assert.equal(valid.status,200);assert.deepEqual(await valid.json(),{ok:true});
  const state=JSON.parse(await readFile(path.join(directory,'state.json'),'utf8'));
  assert.ok(!JSON.stringify(state).includes('bridge@example.com'));
  assert.equal(state.observations.at(-1).remaining,80);
  assert.equal((await fetch(base+'/data/browser-key.json')).status,404);
});

test('external links can navigate to public dashboard but cannot read its API cross-site',async()=>{
  const headers={'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'navigate'};
  // fetch replaces Sec-Fetch-Mode with "cors"; raw HTTP preserves the navigation fixture.
  const status=route=>new Promise((resolve,reject)=>{
    http.get(base+route,{headers},response=>{response.resume();resolve(response.statusCode);}).on('error',reject);
  });
  assert.equal(await status('/'),200);
  assert.equal(await status('/api/dashboard'),403);
});

test('live stream pushes a completed observation immediately without waiting for another provider',async()=>{
  let stream;
  const initial=await new Promise((resolve,reject)=>{
    http.get(base+'/api/events',res=>{stream=res;res.once('data',chunk=>resolve(chunk.toString()));}).on('error',reject);
  });
  assert.match(initial,/^data: /);
  try{
    const next=Promise.race([once(stream,'data'),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('No live event')),2000);timer.unref();})]);
    const response=await post('/api/manual',{provider:'google',accountLabel:'stream-fixture',scopeLabel:'Gemini Apps',window:'Weekly',remaining:64});
    assert.equal(response.status,200);
    const [chunk]=await next;const data=JSON.parse(chunk.toString().slice(6));
    assert.ok(data.pools.some(p=>p.accountLabel==='stream-fixture'&&p.remaining===64));
  }finally{stream.destroy();}
});

test('DeepSeek is a separate unconfigured API balance; no key or fake zero is exposed',async()=>{
  const view=await (await fetch(base+'/api/dashboard')).json();assert.equal(view.providers.length,4);assert.equal(view.api.deepseek.configured,false);assert.deepEqual(view.api.deepseek.balances,[]);
  const skipped=await post('/api/deepseek/sync',{});assert.deepEqual(await skipped.json(),{skipped:true});
  assert.equal((await post('/api/deepseek/connect',{key:'test'},{Origin:'https://example.com'})).status,403);
  const invalid=await post('/api/deepseek/connect',{key:'short'});assert.equal(invalid.status,502);assert.ok(!(await invalid.text()).includes('short'));
  assert.equal((await fetch(base+'/data/deepseek-key.dpapi')).status,404);
});

test('theme preferences persist, broadcast and reject invalid or cross-site writes',async()=>{
  const initial=await (await fetch(base+'/api/dashboard')).json();assert.equal(initial.preferences.theme,'system');
  for(const theme of ['dark','light','system']) {
    const response=await post('/api/preferences',{theme});assert.equal(response.status,200);
    assert.equal((await response.json()).preferences.theme,theme);
    assert.equal(JSON.parse(await readFile(path.join(directory,'state.json'),'utf8')).preferences.theme,theme);
    assert.equal((await (await fetch(base+'/api/dashboard')).json()).preferences.theme,theme);
  }
  assert.equal((await post('/api/preferences',{theme:'purple'})).status,400);
  assert.equal((await post('/api/preferences',{theme:'dark',key:'not-allowed'})).status,400);
  assert.equal((await post('/api/preferences',{theme:'dark'},{Origin:'https://example.com'})).status,403);
  let stream;
  await new Promise((resolve,reject)=>{http.get(base+'/api/events',res=>{stream=res;res.once('data',resolve);}).on('error',reject);});
  try {
    const next=once(stream,'data');await post('/api/preferences',{theme:'dark'});
    const [chunk]=await next;assert.equal(JSON.parse(chunk.toString().slice(6)).preferences.theme,'dark');
  }finally{stream.destroy();}
});

test('tray refresh rejects cross-site requests and reports disconnected extension without collecting',async()=>{
  assert.equal((await post('/api/desktop/refresh',{}, {Origin:'https://example.com'})).status,403);
  const response=await post('/api/desktop/refresh',{});assert.equal(response.status,503);
  const view=await (await fetch(base+'/api/dashboard')).json();assert.equal(view.desktop.connected,false);assert.equal(view.desktop.refresh.status,'idle');assert.equal(view.syncing,false);
});

test('desktop settings entry rejects cross-site calls and caller-supplied commands',async()=>{
  assert.equal((await post('/api/desktop/settings',{}, {Origin:'https://example.com'})).status,403);
  assert.equal((await post('/api/desktop/settings',{command:'unexpected'})).status,400);
});

test('Claude API browser reports replace one organization, preserve others and never enter subscription pools',async()=>{
  const {key}=await (await post('/api/browser/pairing',{})).json();
  const headers={Origin:'chrome-extension://'+'a'.repeat(32),Authorization:`Bearer ${key}`};
  const payload={provider:'claude-api',status:'ok',identity:{kind:'organization',value:'12345678-1234-1234-1234-123456789012'},observedAt:new Date().toISOString(),balance:{currency:'USD',purchased:'0.00',promotional:[{remaining:'75.25',granted:'100.00',expiresOn:'2026-11-01',appliesTo:'API'}]}};
  const before=await (await fetch(base+'/api/dashboard')).json();
  assert.equal((await post('/api/browser/report',payload,headers)).status,200);
  payload.balance.promotional[0].remaining='75.24';assert.equal((await post('/api/browser/report',payload,headers)).status,200);
  let data=await (await fetch(base+'/api/dashboard')).json();
  assert.equal(data.api.claude.accounts.length,1);assert.equal(data.api.claude.accounts[0].promotional[0].remaining,'75.24');
  assert.equal(data.pools.length,before.pools.length);assert.equal(data.providers.length,4);
  payload.identity.value='22345678-1234-1234-1234-123456789012';await post('/api/browser/report',payload,headers);
  await post('/api/browser/report',{provider:'claude-api',status:'error'},headers);
  data=await (await fetch(base+'/api/dashboard')).json();assert.equal(data.api.claude.accounts.length,2);assert.ok(data.api.claude.accounts.every(a=>a.freshness==='stale'));
  const saved=await readFile(path.join(directory,'state.json'),'utf8');assert.ok(!saved.includes(payload.identity.value));
  assert.equal((await post('/api/browser/report',{...payload,balance:{currency:'USD',purchased:'unknown',promotional:[]}},headers)).status,400);
});
