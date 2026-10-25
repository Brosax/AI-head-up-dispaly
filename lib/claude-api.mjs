import {hash,isoDate} from './quotas.mjs';
const money = value => typeof value==='string' && /^\d{1,12}\.\d{2}$/.test(value);
const cents = value => BigInt(value.replace('.',''));
export function normalizeClaudeApi(input,now=Date.now()) {
  if(input.provider!=='claude-api'||!['ok','error','collecting'].includes(input.status))throw Error('无效的 Claude API 采集状态。');
  if(input.status!=='ok')return null;
  const id=input.identity;
  const currentView=id?.kind==='console-view'&&id.value==='current';
  if(!id || typeof id.value!=='string' || !(currentView||(id.kind==='organization'?/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id.value):id.kind==='console-label'&&id.value.trim().length>=3&&id.value.length<=250)))throw Error('缺少 Claude API 账单来源标识。');
  const observedAt=isoDate(input.observedAt),balance=input.balance;
  if(!observedAt||Math.abs(now-Date.parse(observedAt))>120000)throw Error('Claude API 读数已过期。');
  if(balance?.currency!=='USD'||!money(balance.purchased)||!Array.isArray(balance.promotional)||balance.promotional.length>50)throw Error('Claude API 余额格式无效。');
  const promotional=balance.promotional.map(row=>{
    if(!money(row.remaining)||!money(row.granted)||cents(row.remaining)>cents(row.granted)||(row.expiresOn!==null&&(typeof row.expiresOn!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(row.expiresOn)||!Number.isFinite(Date.parse(row.expiresOn))||new Date(row.expiresOn).toISOString().slice(0,10)!==row.expiresOn))||typeof row.appliesTo!=='string'||!row.appliesTo.trim()||row.appliesTo.length>300)throw Error('Claude API 赠送额度格式无效。');
    return {remaining:row.remaining,granted:row.granted,expiresOn:row.expiresOn,expiresLabel:typeof row.expiresLabel==='string'?row.expiresLabel.slice(0,64):null,appliesTo:row.appliesTo.trim()};
  });
  const accountKey=hash(`claude-api:${id.kind}:${id.value.trim().toLowerCase()}`);
  return {accountKey,accountLabel:currentView?'当前 Console 账单':id.kind==='console-label'?`Console · ${typeof id.label==='string'?id.label.slice(0,80):accountKey.slice(0,6)}`:`Console 组织 ${accountKey.slice(0,6)}`,identityVerified:id.kind==='organization',...(currentView?{sourceScope:'current-console-page'}:{}),currency:'USD',purchased:balance.purchased,promotional,observedAt,source:'Claude 官方账单页'};
}
export function claudeApiView(state,now=Date.now()) {
  const value=state.api?.claude||{}, connection=state.browser?.['claude-api']||{};
  const cached=value.accounts||[],current=cached.filter(account=>account.sourceScope==='current-console-page');
  // Historical account-labelled snapshots stay stored, but must not duplicate
  // the current page or be added to its promotional balance.
  const visible=current.length?current:cached;
  return {enabled:true,configured:!!visible.length,status:connection.status||'unknown',error:connection.error||null,
    observedAt:connection.completedAt||null,source:'Claude 官方账单页',accounts:visible.map(account=>({...account,
      freshness:connection.error||now-Date.parse(account.observedAt)>900000?'stale':'fresh'}))};
}
