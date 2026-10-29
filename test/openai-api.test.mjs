import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import '../extension/openai-api.js';
import {normalizeOpenaiApi,openaiApiView} from '../lib/openai-api.mjs';
import {mountApiBalances} from '../public/api-balances.js';
const now=new Date('2026-10-29T10:00:00Z');
const doc=html=>parseHTML(`<html><body>${html}</body></html>`).document;
// Structure observed on the user's OpenAI Platform home, with unrelated UI removed.
const card=(value='$82.00',label='Credit remaining')=>`<div class="flex h-full flex-col"><div>${label}</div><div class="flex items-center gap-1 text-lg font-semibold">${value}</div><div><a href="/settings/organization/billing/overview" data-credit-purchase-location="home-credit-balance"><span>添加额度</span></a></div></div>`;
const read=html=>globalThis.HeadroomOpenaiApi.extract(doc(html),now);
const payload=()=>({provider:'openai-api',status:'ok',identity:{kind:'platform-view',value:'current'},observedAt:now.toISOString(),balance:read(card())});

test('OpenAI home reads the observed credit card, never model prices, spend or budgets',()=>{
  const balance=read(`<section>Monthly budget $500.00</section>${card()}<div>Model pricing $1.00</div>`);
  assert.deepEqual(balance,{currency:'USD',remaining:'82.00',observedAt:now.toISOString()});
  assert.equal(read('<div>Credit remaining $82.00</div>'),null);
  assert.equal(read(card('$20.00','Total spend')),null);
});
test('zero and negative credits are explicit; loading or ambiguous readings stay unknown',()=>{
  for(const [value,expected] of [['$0.00','0.00'],['US$1,234.56','1234.56'],['-$0.25','-0.25'],['$-1.00','-1.00']])assert.equal(read(card(value)).remaining,expected);
  for(const value of ['Loading…','—','$82','€82.00','$1,23.00'])assert.equal(read(card(value)),null);
  assert.equal(read(card()+card('$12.00')),null);
  assert.equal(read(`<div hidden>${card()}</div>`),null);
  assert.equal(read(card()+card()).remaining,'82.00');
});
test('normalizer accepts only a fresh USD platform snapshot and excludes credentials or extra fields',()=>{
  const value=normalizeOpenaiApi(payload(),+now);
  assert.equal(value.remaining,'82.00');assert.equal(value.identityVerified,false);
  for(const change of [p=>p.identity=null,p=>p.balance.remaining=82,p=>p.balance.remaining='NaN',p=>p.balance.currency='EUR',p=>p.observedAt='2020-01-01',p=>p.provider='openai']){
    const p=payload();change(p);assert.throws(()=>normalizeOpenaiApi(p,+now));
  }
  assert.equal(normalizeOpenaiApi({provider:'openai-api',status:'collecting'},+now),null);
});
test('missing balance is unknown; refresh failure retains its prior amount as stale',()=>{
  assert.equal(openaiApiView({},+now).remaining,null);
  const state={api:{openai:normalizeOpenaiApi(payload(),+now)}};
  assert.equal(openaiApiView(state,+now).freshness,'fresh');
  state.browser={'openai-api':{status:'error',error:'未读到余额'}};
  const view=openaiApiView(state,+now);assert.equal(view.remaining,'82.00');assert.equal(view.freshness,'stale');
});
test('compact toolbar adds one money row and keeps unknown, zero and stale distinct',()=>{
  const previous=globalThis.document;globalThis.document=doc('<div id="balances"></div>');
  try {
    const mounted=mountApiBalances('#balances',{compact:true});
    mounted.render({}, {}, {remaining:null});
    let row=document.querySelector('[data-provider="openai-api"]');
    assert.match(row.textContent,/等待首次读取/);assert.equal(row.querySelector('strong'),null);
    mounted.render({}, {}, {remaining:'0.00',freshness:'stale'});
    row=document.querySelector('[data-provider="openai-api"]');
    assert.match(row.textContent,/\$ 0.00/);assert.match(row.textContent,/上次读数/);
    assert.equal(row.querySelector('[role="meter"]'),null);
    assert.equal(row.querySelector('a').getAttribute('href'),'https://platform.openai.com/home');
  }finally{globalThis.document=previous;}
});
