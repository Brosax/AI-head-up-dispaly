import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import '../extension/claude-api.js';
import {normalizeClaudeApi,claudeApiView} from '../lib/claude-api.mjs';
const {extract,identity}=globalThis.HeadroomClaudeApi;
const now=new Date('2026-10-25T10:00:00Z');
const org='12345678-1234-1234-1234-123456789012';
const table=`<section><h2>Promotional credits</h2><p>All dates are in UTC.</p><table aria-label="Promotional credits"><thead><tr><th>Remaining balance</th><th>Applies to</th><th>Expires on</th><th>Date granted</th></tr></thead><tbody><tr><td>$75.25 <span>of $100.00</span></td><td>API, Playground</td><td>11/1/2026</td><td>10/15/2026</td></tr></tbody></table></section>`;
const html=`<a href="/settings/billing">US$75.26</a><section><h2>Credit balance</h2><div data-testid="credit-balance"><div><span>$0.00</span></div><div>$75.25 promotional credit available</div></div></section>${table}<section>Monthly spend limit $500</section>`;
const doc=html=>parseHTML(`<html><body>${html}</body></html>`).document;
const payload=()=>({provider:'claude-api',status:'ok',identity:{kind:'organization',value:org},observedAt:now.toISOString(),balance:extract(doc(html),now)});
test('Console parser reads scoped billing detail, not header balance or spend cap; expiry stays a UTC date',()=>{
  const result=extract(doc(html),now);
  assert.equal(result.purchased,'0.00');assert.equal(result.promotional.length,1);
  assert.deepEqual(result.promotional[0],{remaining:'75.25',granted:'100.00',expiresOn:'2026-11-01',expiresLabel:'11/1/2026',appliesTo:'API, Playground'});
});
test('loading and missing promotional details remain unknown',()=>{
  for(const invalid of [html.replace(table,''),html.replace('$0.00','Loading')])assert.equal(extract(doc(invalid),now),null);
  assert.equal(extract(doc('<p>$100 credits</p>'),now),null);
});
test('zero purchased-only balance and thousands separators are explicit, not fabricated',()=>{
  assert.deepEqual(extract(doc('<section><h2>Credit balance</h2><div data-testid="credit-balance"><div>$1,234.56</div></div></section>'),now).promotional,[]);
  assert.equal(extract(doc('<section><h2>Credit balance</h2><div data-testid="credit-balance"><div>$1,234.56</div></div></section>'),now).purchased,'1234.56');
});
test('visible account switcher identifies this browser source without opening organization settings',()=>{
  assert.deepEqual(identity(doc('<nav><button aria-haspopup="menu"><span>\ue001</span><div>Demo User</div><div>Example Workspace</div><span>\ue002</span></button></nav>')),{kind:'console-label',value:'Demo User / Example Workspace',label:'Example Workspace'});
  assert.equal(identity(doc('<p>Demo User Example Workspace</p>')),null);
});

test('billing identity skips unrelated menus and handles inline name labels',()=>{
  const page=doc('<nav><button aria-haspopup="menu">Help</button><button aria-haspopup="menu"><span>Demo User</span><span>Example Workspace</span></button></nav>');
  assert.deepEqual(identity(page),{kind:'console-label',value:'Demo User / Example Workspace',label:'Example Workspace'});
});
test('text parser tolerates changed table headings and rounding but retains unknown expiry',()=>{
  const value=extract(doc(html.replace('Remaining balance','Balance').replace('$75.25 <span>of','$75.24 <span>of').replace('11/1/2026','Not shown')),now);
  assert.equal(value.promotional[0].remaining,'75.24');assert.equal(value.promotional[0].expiresOn,null);
});

test('promotional balance reads adjacent inline text without an inserted space',()=>{
  const value=extract(doc(html.replace('$75.25 <span>of','$75.25<span>of')),now);
  assert.equal(value.promotional[0].remaining,'75.25');
});
test('normalization hashes org identity, preserves exact money and validates dates/amounts',()=>{
  const result=normalizeClaudeApi(payload(),+now);assert.ok(!JSON.stringify(result).includes(org));
  assert.equal(result.promotional[0].remaining,'75.25');
  assert.equal(normalizeClaudeApi(payload(),+now).accountKey,result.accountKey);
  for(const change of [p=>p.identity=null,p=>p.balance.purchased=-1,p=>p.balance.promotional[0].expiresOn='2026-02-30',p=>p.balance.promotional[0].remaining='100.01',p=>p.observedAt='2020-01-01']){const p=payload();change(p);assert.throws(()=>normalizeClaudeApi(p,+now));}
});
test('failed refresh preserves previous amounts as stale; no fabricated empty balance',()=>{
  assert.deepEqual(claudeApiView({},+now).accounts,[]);
  const account=normalizeClaudeApi(payload(),+now);
  const view=claudeApiView({api:{claude:{accounts:[account]}},browser:{'claude-api':{error:'offline'}}},+now);
  assert.equal(view.accounts[0].freshness,'stale');assert.equal(view.accounts[0].promotional[0].remaining,'75.25');
});

test('current billing page works without account menu and never duplicates historical account readings',()=>{
  const legacy=normalizeClaudeApi(payload(),+now);
  const input={...payload(),identity:{kind:'console-view',value:'current'}};
  const current=normalizeClaudeApi(input,+now);
  assert.equal(current.identityVerified,false);assert.equal(current.sourceScope,'current-console-page');
  const view=claudeApiView({api:{claude:{accounts:[legacy,current]}}},+now);
  assert.equal(view.accounts.length,1);assert.equal(view.accounts[0].accountKey,current.accountKey);
  assert.equal(view.accounts[0].promotional[0].remaining,'75.25');
  assert.throws(()=>normalizeClaudeApi({...input,identity:{kind:'console-view',value:'invented-account'}},+now));
});
