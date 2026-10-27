import {request,subscribeDashboard} from './client.js';
import {mountApiBalances} from './api-balances.js';
import {resetText} from './reset-time.js';
const $=s=>document.querySelector(s);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let data,busy=false,startedAt=null;
const apiBalances=mountApiBalances('#api-balances',{compact:true,onUpdated:value=>{data=value;render();$('#message').textContent='DeepSeek API 已连接，余额已读取。';}});
const windows={'Weekly':'本周','Session (5hr)':'5 小时','Session':'当前周期'};
const time=value=>value?new Intl.DateTimeFormat('zh-CN',{timeZone:'Europe/Madrid',hour:'2-digit',minute:'2-digit'}).format(new Date(value)):'—';
function render(){
  if(!data)return;
  const job=data.desktop?.refresh;
  if(job?.status==='running'){busy=true;startedAt=job.startedAt;}
  else if(busy&&job?.finishedAt&&job.finishedAt>=startedAt){busy=false;$('#message').textContent=job.error||'更新完成';}
  $('#refresh').disabled=busy;$('#refresh-icon').classList.toggle('spinning',busy);$('#refresh-text').textContent=busy?'更新中':'全部更新';
  $('#connection').textContent='本机已连接';
  $('#hint').textContent=data.lastUpdatedAt?'最后刷新 '+new Intl.DateTimeFormat('zh-CN',{timeZone:'Europe/Madrid',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(data.lastUpdatedAt)):'尚无刷新记录';
  $('#hint').title='最近一次成功读入数据的时间（马德里）；部分平台失败时保留旧读数。';
  apiBalances.render(data.api?.deepseek,data.api?.claude);
  $('#providers').innerHTML=data.providers.map(provider=>{
    const pools=data.pools.filter(p=>p.provider===provider.id);
    const connection=provider.id==='openai'?{...data.sync,status:data.syncing?'collecting':data.sync.error?'error':'ok'}:data.browser?.[provider.id];
    const current=pools.toSorted((a,b)=>b.observedAt.localeCompare(a.observedAt))[0];
    const pending=connection?.status==='collecting'||(busy&&(!current||current.observedAt<startedAt)&&!connection?.error);
    const failed=!!connection?.error;
    const status=failed?'读取失败':pending?'后台读取中':current?`${time(current.observedAt)} 更新`:'尚未接入';
    return `<article class="quota-row" data-provider="${provider.id}"><div class="provider-heading"><h2>${provider.id==='openai'?'Codex':provider.name}</h2>${pending||failed?`<p class="state ${pending?'loading':'error'}">${pending?'读取中':'上次读数'}</p>`:''}</div>${pools.length?`<div class="metrics">${pools.map(pool=>{const number=pool.remaining===null?'—':Number(pool.remaining.toFixed(1))+'%';return `<div class="metric"><div class="metric-caption"><span>${escape(windows[pool.window]||pool.window)}</span><span class="reset" title="${escape(pool.resetsAt||pool.resetLabel||'')}">${resetText(pool)}</span></div><strong class="value" style="--quota-progress:${pool.remaining??0}%" role="meter" aria-label="${escape(provider.name+' '+(windows[pool.window]||pool.window)+' 剩余')}" ${pool.remaining===null?'aria-valuetext="未知"':`aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pool.remaining}"`}><span>${number}</span><span class="filled-label" aria-hidden="true">${number}</span></strong>${new Set(pools.map(p=>p.accountKey)).size>1?`<p class="account">${escape(pool.accountLabel)}</p>`:''}</div>`;}).join('')}</div>`:'<p class="empty">等待首次读取</p>'}</article>`;
  }).join('');
  const isDark=document.documentElement.dataset.theme==='dark';$('#theme-toggle').textContent=isDark?'☀':'☾';$('#theme-toggle').title=isDark?'切换到亮色':'切换到暗色';$('#theme-toggle').setAttribute('aria-label',$('#theme-toggle').title);
  const api=data.api?.deepseek,claude=data.api?.claude,total=4+(api?.configured?1:0)+(claude?.enabled?1:0);
  const done=data.providers.filter(p=>data.pools.some(q=>q.provider===p.id&&q.observedAt>=startedAt)).length+(api?.configured&&api.observedAt>=startedAt?1:0)+(claude?.observedAt>=startedAt?1:0);
  const fresh=data.stats.connected+(api?.configured&&api.freshness==='fresh'?1:0)+(claude?.accounts?.some(a=>a.freshness==='fresh')?1:0);
  $('#summary').textContent=busy?`${done} / ${total} 家已更新`:`${fresh} / ${total} 家读数有效`;
}
async function load(){try{data=await request('/api/dashboard');render();}catch{$('#connection').textContent='服务未连接';}}
$('#refresh').onclick=async()=>{
  if(busy)return;busy=true;startedAt=new Date().toISOString();$('#message').textContent='正在后台读取，完成一家即显示一家。';render();
  try{const result=await request('/api/desktop/refresh',{});data.desktop=result.desktop;render();}
  catch(error){busy=false;$('#message').textContent=error.message;render();}
};
await load();subscribeDashboard(value=>{data=value;render();});
setInterval(load,60000); // Refresh local display/age only; never initiates provider collection.
$('#desktop-settings').onclick=async()=>{const button=$('#desktop-settings');button.disabled=true;try{await request('/api/desktop/settings',{});$('#message').textContent='设置窗口已打开。';}catch(error){$('#message').textContent=error.message;}finally{button.disabled=false;}};

$('#theme-toggle').onclick=async()=>{const button=$('#theme-toggle');button.disabled=true;try{const next=document.documentElement.dataset.theme==='dark'?'light':'dark';const value=await request('/api/preferences',{theme:next});document.dispatchEvent(new CustomEvent('headroom:preferences',{detail:value.preferences}));render();}catch(error){$('#message').textContent=error.message;}finally{button.disabled=false;}};
