import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {fetchBalance,normalizeBalance,apiView,BALANCE_URL} from '../lib/deepseek.mjs';
import {protectSecret} from '../lib/vault.mjs';
const fixture=()=>({is_available:true,balance_infos:[{currency:'CNY',total_balance:'12.345678',granted_balance:'2.00',topped_up_balance:'10.345678'}]});
test('API money preserves decimal strings and currency, never becomes a percent quota',()=>{
  const raw=fixture();raw.balance_infos.push({currency:'USD',total_balance:'0.12',granted_balance:'0.00',topped_up_balance:'0.12'});
  const result=normalizeBalance(raw);assert.equal(result.balances.length,2);assert.equal(result.balances[0].total,'12.345678');assert.equal(result.balances[1].currency,'USD');assert.equal(result.remaining,undefined);
});
test('missing, malformed, duplicated currency and nonfinite balances are rejected rather than set to zero',()=>{
  for(const raw of [{}, {is_available:true,balance_infos:[]}, {...fixture(),is_available:'yes'}])assert.throws(()=>normalizeBalance(raw));
  const missing=fixture();delete missing.balance_infos[0].total_balance;assert.throws(()=>normalizeBalance(missing));
  const invalid=fixture();invalid.balance_infos[0].total_balance='NaN';assert.throws(()=>normalizeBalance(invalid));
  const duplicated=fixture();duplicated.balance_infos.push({...duplicated.balance_infos[0]});assert.throws(()=>normalizeBalance(duplicated));
});
test('zero and negative balances retain official availability without inferring either',()=>{
  const raw=fixture();raw.is_available=false;raw.balance_infos[0].total_balance='-0.001';const result=normalizeBalance(raw);assert.equal(result.isAvailable,false);assert.equal(result.balances[0].total,'-0.001');
});
test('balance collector only calls official GET endpoint, disables redirects and redacts failure bodies',async()=>{
  const key='sk-test-fixture-not-a-real-key';let called;
  const result=await fetchBalance(key,async(url,options)=>{called={url,options};return {ok:true,json:async()=>fixture()};});
  assert.equal(called.url,BALANCE_URL);assert.equal(called.options.method,'GET');assert.equal(called.options.redirect,'error');assert.equal(called.options.headers.Authorization,`Bearer ${key}`);assert.equal(result.balances[0].currency,'CNY');
  await assert.rejects(()=>fetchBalance(key,async()=>({ok:false,status:401,text:async()=>key})),error=>!error.message.includes(key)&&/密钥无效/.test(error.message));
  await assert.rejects(()=>fetchBalance(key,async()=>{throw new Error(key);}),error=>!error.message.includes(key));
});
test('failed or old API snapshot stays stale and API view cannot expose secret metadata',()=>{
  const now=Date.now(),value={...normalizeBalance(fixture(),new Date(now).toISOString()),status:'error',error:'failed',key:'must-not-be-returned'};
  const result=apiView({api:{deepseek:value}},true,now);assert.equal(result.deepseek.freshness,'stale');assert.equal(result.deepseek.balances[0].total,'12.345678');assert.ok(!JSON.stringify(result).includes('must-not-be-returned'));
  value.error=null;assert.equal(apiView({api:{deepseek:value}},true,now+900001).deepseek.freshness,'stale');
});
test('Windows credential vault round-trips test secret without storing it in the protected value',{skip:process.platform!=='win32'},async()=>{
  const root=fileURLToPath(new URL('..',import.meta.url)),secret='headroom-fixture-not-a-real-api-key';
  const encrypted=await protectSecret(root,'protect',secret);assert.ok(!encrypted.includes(secret));assert.notEqual(encrypted,Buffer.from(secret).toString('base64'));
  assert.equal(await protectSecret(root,'unprotect',encrypted),secret);
});
