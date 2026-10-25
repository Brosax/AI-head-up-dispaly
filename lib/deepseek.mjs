export const BALANCE_URL='https://api.deepseek.com/user/balance';
const amount=value=>typeof value==='string'&&/^-?\d{1,15}(?:\.\d{1,12})?$/.test(value);
export function normalizeBalance(raw,observedAt=new Date().toISOString()){
  if(typeof raw?.is_available!=='boolean'||!Array.isArray(raw.balance_infos)||!raw.balance_infos.length||raw.balance_infos.length>2)throw new Error('DeepSeek 未返回有效余额，保留上次读数。');
  const seen=new Set();
  const balances=raw.balance_infos.map(row=>{
    if(!['CNY','USD'].includes(row.currency)||seen.has(row.currency)||!['total_balance','granted_balance','topped_up_balance'].every(k=>amount(row[k])))throw new Error('DeepSeek 余额字段无效，保留上次读数。');
    seen.add(row.currency);
    // Keep provider decimal strings and currencies intact; never convert money into a quota percentage.
    return {currency:row.currency,total:row.total_balance,granted:row.granted_balance,toppedUp:row.topped_up_balance};
  });
  return {isAvailable:raw.is_available,balances,observedAt,source:'DeepSeek 官方 API'};
}
export async function fetchBalance(key,fetcher=fetch){
  if(typeof key!=='string'||!/^\S{16,256}$/.test(key))throw new Error('请填写有效的 DeepSeek API Key。');
  let response;
  try{response=await fetcher(BALANCE_URL,{method:'GET',headers:{Authorization:`Bearer ${key}`,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(12000)});}
  catch{throw new Error('DeepSeek 余额读取超时或网络不可用，保留上次读数。');}
  if(!response.ok)throw new Error(response.status===401||response.status===403?'DeepSeek 密钥无效或权限不足，请在本地重新配置。':response.status===429?'DeepSeek 请求过于频繁，请稍后重试。':'DeepSeek 暂时无法返回余额，保留上次读数。');
  let raw;try{raw=await response.json();}catch{throw new Error('DeepSeek 未返回有效 JSON，保留上次读数。');}
  return normalizeBalance(raw);
}
export function apiView(state,configured,now=Date.now()){
  const value=state.api?.deepseek||{};
  return {deepseek:{configured,status:value.status||'unknown',error:value.error||null,attemptedAt:value.attemptedAt||null,
    observedAt:value.observedAt||null,isAvailable:typeof value.isAvailable==='boolean'?value.isAvailable:null,
    freshness:!value.observedAt?'unknown':value.error||now-Date.parse(value.observedAt)>900000?'stale':'fresh',
    balances:value.balances||[],source:'DeepSeek 官方 API'}};
}
