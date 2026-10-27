import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import '../extension/parser.js';
import { normalizeBrowser } from '../lib/browser.mjs';
import { normalizeTokscale, mergeObservations, dashboard } from '../lib/quotas.mjs';
const {extract,identity,resetDate}=globalThis.HeadroomParser;
const documentOf=html=>parseHTML(`<html><body>${html}</body></html>`).document;
const now=new Date('2026-10-24T20:45:00Z');
test('Claude reads the explicit organization control without relying on dialog text layout',()=>{
  const id='12345678-1234-1234-1234-123456789012';
  const doc=documentOf(`<section>Organization ID<button aria-label="Copy organization ID"><span>${id}</span><span>\uE000</span></button></section>`);
  assert.deepEqual(identity(doc,'anthropic'),{kind:'organization',value:id});
  assert.equal(identity(documentOf(`<p>${id}</p>`),'anthropic'),null);
});
function meter(label,value,extra='') {return `<section><div><span id="${label}">${label}</span><span>Resets Saturday 6:00 PM</span></div><div><div><div role="meter" aria-labelledby="${label}" aria-valuenow="${value}"></div></div><span>${value}% used</span></div>${extra}</section>`;}
test('Claude reads session/week meters, excludes product percentages and credit balances',()=>{
  const doc=documentOf(`<div role="dialog">Max (5x)${meter('Current session',50)}${meter('This week',6)}${meter('Claude Code',100)}${meter('Included credit',0)}</div>`);
  const result=extract(doc,'anthropic',now);
  assert.deepEqual(result.metrics.map(m=>[m.window,m.used]),[['Session (5hr)',50],['Weekly',6]]);
  assert.equal(result.plan,'Max (5x)');
});

test('Claude refresh replaces an expired session even when its reset text is not available',()=>{
  const doc=documentOf(`<div role="dialog"><section><span id="session">Current session</span><div role="meter" aria-labelledby="session" aria-valuenow="0"></div></section>${meter('This week',7)}</div>`);
  const result=extract(doc,'anthropic',now);
  assert.deepEqual(result.metrics.map(m=>[m.window,m.used]),[['Session (5hr)',0],['Weekly',7]]);
  assert.equal(result.metrics[0].resetsAt,null);
  assert.equal(result.metrics[0].resetLabel,'');
  const previous=sample();previous.metrics=[{window:'Session (5hr)',used:50,resetsAt:null},{window:'Weekly',used:6,resetsAt:null}];
  const next={...sample(),metrics:result.metrics,observedAt:new Date(+now+1000).toISOString()};
  const state={observations:mergeObservations(normalizeBrowser(previous,+now),normalizeBrowser(next,+now+1000))};
  assert.equal(dashboard(state,+now+1000).pools.find(p=>p.window==='Session (5hr)').remaining,100);
});
test('Gemini only parses official current/weekly components, never an injected usage pill or upsell',()=>{
  const doc=documentOf('<div id="gv-usage-pill">5h 95% 每周 99%</div><div data-testid="current-usage"><strong>当前用量</strong><strong>已使用 0%</strong><span>重置时间：23:22</span></div><div data-testid="weekly-usage"><span>每周限额</span><span>重置时间：10月27日9:22</span><strong>已使用 0%</strong></div><h2>升级到 Ultra 500%</h2>');
  const result=extract(doc,'google',now);assert.equal(result.metrics.length,2);assert.ok(result.metrics.every(m=>m.used===0));
});
test('Grok uses the total percentage, not the Grok Bot breakdown',()=>{
  const doc=documentOf('<section><div><h3>Límite semanal Premium</h3></div><div><number-flow-react aria-label="76%"></number-flow-react><span>usado</span><span>Se restablece <span>27 de octubre de 2026 a las 21:07</span></span><span>Grok Bot</span><span>12%</span></div></section>');
  const result=extract(doc,'xai',now);assert.equal(result.metrics[0].used,76);assert.equal(result.plan,'Premium');assert.ok(result.metrics[0].resetsAt);
});
test('missing/malformed DOM stays unknown rather than inventing a zero',()=>{
  for(const provider of ['anthropic','google','xai']) assert.deepEqual(extract(documentOf('<p>some unrelated 20%</p>'),provider,now).metrics,[]);
  assert.equal(extract(documentOf('<div data-testid="current-usage">已使用 150%</div>'),'google',now).metrics.length,0);
});
test('account identity only comes from scoped settings or Google account label',()=>{
  assert.equal(identity(documentOf('<p>outside@example.com</p>'),'xai'),null);
  assert.deepEqual(identity(documentOf('<div role="dialog">Organization ID\n12345678-1234-1234-1234-123456789012</div>'),'anthropic'),{kind:'organization',value:'12345678-1234-1234-1234-123456789012'});
  assert.deepEqual(identity(documentOf('<a href="https://accounts.google.com/SignOutOptions" aria-label="Google 账号：Test (test@example.com)"></a>'),'google'),{kind:'email',value:'test@example.com'});
});
test('reset labels handle supported locales and reject ambiguous dates',()=>{
  assert.equal(resetDate('sometime at 12:00',now),null);
  assert.equal(resetDate('Resets at 25:99',now),null);
  assert.ok(resetDate('重置时间：10月27日9:22',now));
  assert.ok(resetDate('Se restablece 27 de octubre de 2026 a las 21:07',now));
  assert.ok(resetDate('Resets Saturday 6:00 PM',now));
});
const sample=()=>({provider:'anthropic',status:'ok',identity:{kind:'organization',value:'12345678-1234-1234-1234-123456789012'},observedAt:now.toISOString(),metrics:[{window:'Weekly',used:6,resetsAt:null}]});
test('browser refresh updates the same shared pool, hashes identity, and never adds percentages',()=>{
  const first=normalizeBrowser(sample(),+now);const input=sample();input.metrics[0].used=7;input.observedAt=new Date(+now+1000).toISOString();
  const second=normalizeBrowser(input,+now+1000);
  const state={observations:mergeObservations(first,second)};const result=dashboard(state,+now+1000);
  assert.equal(result.pools.length,1);assert.equal(result.pools[0].remaining,93);assert.deepEqual(result.pools[0].channels,['Claude 网页版','Claude Code']);
  assert.ok(!JSON.stringify(state).includes(sample().identity.value));
});
test('browser validation rejects duplicate metrics, unsupported sources, unknown identities and stale clocks',()=>{
  let input=sample();input.metrics.push({...input.metrics[0]});assert.throws(()=>normalizeBrowser(input,+now));
  input=sample();input.identity=null;assert.throws(()=>normalizeBrowser(input,+now));
  input=sample();input.provider='openai';assert.throws(()=>normalizeBrowser(input,+now));
  assert.throws(()=>normalizeBrowser(sample(),+now+300000));
});
test('browser authority hides duplicate CLI pools and a failed collection makes old values stale',()=>{
  const browser=normalizeBrowser(sample(),+now);const cli=normalizeTokscale([{provider:'Claude',metrics:[{label:'Weekly',used_percent:6}]}],now.toISOString()).observations;
  const state={observations:[...cli,...browser],browser:{anthropic:{authoritative:true,receivedPoolIds:browser.map(o=>o.poolId)}}};
  assert.equal(dashboard(state,+now).pools.length,1);
  state.browser.anthropic.error='failed';assert.equal(dashboard(state,+now).pools[0].status,'stale');
});
