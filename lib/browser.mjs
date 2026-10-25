import { randomUUID } from 'node:crypto';
import { hash, isoDate } from './quotas.mjs';
const adapters={
  anthropic:{scope:'claude-subscription',scopeLabel:'Claude 订阅',channels:['Claude 网页版','Claude Code'],identityKinds:['organization']},
  xai:{scope:'grok',scopeLabel:'Grok 订阅',channels:['Grok 网页版','Grok Bot'],identityKinds:['email']},
  google:{scope:'gemini-apps',scopeLabel:'Gemini Apps',channels:['Gemini 网页版'],identityKinds:['email']},
};
export function normalizeBrowser(input, now=Date.now()) {
  const adapter=Object.hasOwn(adapters,input.provider)?adapters[input.provider]:null;
  if(!adapter) throw new Error('不支持的浏览器额度来源。');
  if(!['ok','error','collecting','paired'].includes(input.status)) throw new Error('无效的采集状态。');
  if(input.status!=='ok') return [];
  const identity=input.identity;
  if(!identity || !adapter.identityKinds.includes(identity.kind) || typeof identity.value!=='string') throw new Error('缺少经过核对的账户身份。');
  const value=identity.value.trim().toLowerCase();
  if(value.length>250 || !(identity.kind==='email'?/^[^\s@]+@[^\s@]+\.[^\s@]+$/:/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/).test(value)) throw new Error('账户标识格式无效。');
  const observedAt=isoDate(input.observedAt);
  if(!observedAt || Math.abs(now-Date.parse(observedAt))>120000) throw new Error('浏览器读数时间无效或已过期。');
  if(!Array.isArray(input.metrics) || !input.metrics.length || input.metrics.length>2) throw new Error('缺少有效额度窗口。');
  const accountKey=hash(`${input.provider}:${identity.kind}:${value}`);
  const accountLabel=identity.kind==='email'?`${value.slice(0,2)}•••@${value.split('@')[1]}`:`Claude 账户 ${accountKey.slice(0,6)}`;
  const seen=new Set();
  return input.metrics.map(metric=>{
    if(!['Weekly','Session (5hr)'].includes(metric.window) || seen.has(metric.window) || (input.provider==='xai' && metric.window!=='Weekly')) throw new Error('额度窗口重复或不支持。');
    seen.add(metric.window);
    if(typeof metric.used!=='number' || !Number.isFinite(metric.used) || metric.used<0 || metric.used>100) throw new Error('额度百分比无效。');
    const resetsAt=isoDate(metric.resetsAt);
    if(metric.resetsAt && (!resetsAt || Date.parse(resetsAt)<=Date.parse(observedAt) || Date.parse(resetsAt)-Date.parse(observedAt)>8*86400000)) throw new Error('重置时间无效。');
    return {id:randomUUID(),poolId:hash(`${input.provider}|${accountKey}|${adapter.scope}|${metric.window.toLowerCase()}`),provider:input.provider,accountKey,accountLabel,identityVerified:true,...adapter,identityKinds:undefined,
      window:metric.window,plan:typeof input.plan==='string'?input.plan.slice(0,80):null,remaining:100-metric.used,resetsAt,
      resetLabel:typeof metric.resetLabel==='string'?metric.resetLabel.slice(0,140):null,observedAt,source:'browser',sourceLabel:'浏览器自动采集',evidence:'provider',
      rule:'同账户、同功能和周期只保留一个读数；网页登录为此平台主来源，产品使用占比不另建额度池。'};
  });
}
