import {isoDate} from './quotas.mjs';
export function normalizeOpenaiApi(input,now=Date.now()) {
  if(input.provider!=='openai-api'||!['ok','error','collecting'].includes(input.status))throw Error('无效的 OpenAI API 采集状态。');
  if(input.status!=='ok')return null;
  if(input.identity?.kind!=='platform-view'||input.identity.value!=='current')throw Error('缺少 OpenAI API 余额来源标识。');
  const observedAt=isoDate(input.observedAt),balance=input.balance;
  if(!observedAt||Math.abs(now-Date.parse(observedAt))>120000)throw Error('OpenAI API 读数已过期。');
  if(balance?.currency!=='USD'||typeof balance.remaining!=='string'||! /^-?\d{1,12}\.\d{2}$/.test(balance.remaining))throw Error('OpenAI API 余额格式无效。');
  return {currency:'USD',remaining:balance.remaining,observedAt,source:'OpenAI 官方平台首页',sourceScope:'current-platform-page',identityVerified:false};
}
export function openaiApiView(state,now=Date.now()) {
  const value=state.api?.openai||{},connection=state.browser?.['openai-api']||{};
  const configured=!!value.observedAt;
  return {...value,enabled:true,configured,status:connection.status||'unknown',error:connection.error||null,
    currency:'USD',remaining:configured?value.remaining:null,observedAt:value.observedAt||null,
    freshness:!configured?'unknown':connection.error||now-Date.parse(value.observedAt)>900000?'stale':'fresh'};
}
