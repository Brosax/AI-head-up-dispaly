importScripts('desktop-link.js');
const ENDPOINT = 'http://127.0.0.1:4317/api/browser/report';
const PROVIDERS = {
  'claude-api': { usage:'https://platform.claude.com/settings/billing' },
  anthropic: { account:'https://claude.ai/settings/account', usage:'https://claude.ai/settings/usage' },
  xai: { account:'https://grok.com/?_s=home', usage:'https://grok.com/?_s=usage' },
  google: { usage:'https://gemini.google.com/usage' },
};
let running = false;
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
const missingTab = error => error?.code==='tab-closed' || /No tab with id:\s*\d+|Invalid tab ID/i.test(error?.message||'');
async function report(token,payload) {
  const response = await fetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)});
  if (!response.ok) throw new Error(response.status===401?'配对码无效，请重新配对':'本地面板拒绝了采集结果');
}
async function probe(tabId,stage,requireIdentity=false) {
  let reason='script-unavailable';
  for(let i=0;i<60;i++) {
    try {
      // The content script knows whether the quota DOM is ready. Do not wait for
      // unrelated images/analytics to finish the entire page load.
      const result = await chrome.tabs.sendMessage(tabId,{type:'headroom-probe',stage});
      const ready=stage==='identity'?!!result?.identity:!!(result?.metrics?.length||result?.balance);
      reason=result?.error==='wrong-page'?'wrong-page':!ready?(stage==='identity'?'identity-missing':'usage-missing'):requireIdentity&&!result?.identity?'identity-missing':null;
      if (ready && (!requireIdentity || result?.identity)) return result;
    } catch(error) {
      if(missingTab(error)){error.code='tab-closed';throw error;}
    }
    await sleep(500);
  }
  const error=new Error('未读到用量或账户身份，请检查登录、页面语言或页面结构');error.code=reason;throw error;
}
async function cycle() {
  const {token,enabled} = await chrome.storage.local.get(['token','enabled']);
  if (!token || !enabled) return {error:'扩展未配对或已暂停，请在扩展菜单开启。'};
  if (running) return {error:'已有后台采集正在运行，请稍候。'};
  running=true;
  const errors=[];
  try {
    // Never reload/close user tabs. Only these temporary, inactive collection tabs are touched.
    const {ownedTabs=[]}=await chrome.storage.local.get('ownedTabs');
    for(const id of ownedTabs) { try {await chrome.tabs.remove(id);} catch {} }
    await chrome.storage.local.set({ownedTabs:[]});
    const owned=new Set();let tracking=Promise.resolve();
    const track=(id,add)=>{
      tracking=tracking.then(async()=>{if(add)owned.add(id);else owned.delete(id);await chrome.storage.local.set({ownedTabs:[...owned]});});
      return tracking;
    };
    await Promise.allSettled(Object.entries(PROVIDERS).map(async([provider,urls])=>{
      let tab;
      const releaseTab=async()=>{
        const old=tab;tab=null;
        if(!old)return;
        try {await chrome.tabs.remove(old.id);} catch {}
        await track(old.id,false);
      };
      try {
        await report(token,{provider,status:'collecting'}); // Stop before opening tabs if local app is off.
        let identity,result;
        for(let attempt=0;attempt<2;attempt++) {
          try {
            // Identity belongs to this document; never carry it into a replacement tab.
            identity=undefined;
            tab=await chrome.tabs.create({url:urls.account||urls.usage,active:false});
            await track(tab.id,true);
            await chrome.tabs.update(tab.id,{autoDiscardable:false});
            if(urls.account) {
              ({identity}=await probe(tab.id,'identity'));
              await chrome.tabs.update(tab.id,{url:urls.usage});
            }
            result=await probe(tab.id,'usage',!identity);
            break;
          } catch(error) {
            if(missingTab(error))error.code='tab-closed';
            const recoverable=error.code==='tab-closed'||provider==='claude-api'&&error.code==='script-unavailable';
            if(attempt===1||!recoverable)throw error;
            // The old ID may no longer exist. Replace our temporary tab once,
            // instead of repeatedly messaging/reloading a dead ID.
            await releaseTab();
          }
        }
        identity ||= result.identity;
        if(!identity) throw new Error('未读到当前账户身份；本次不合并额度');
        await report(token,{provider,status:'ok',identity,metrics:result.metrics,balance:result.balance,plan:result.plan,observedAt:result.observedAt});
        await chrome.storage.local.set({[provider]:{status:'ok',at:new Date().toISOString()}});
      } catch(error) {
        const message=missingTab(error)?'临时采集页再次关闭，自动恢复未完成，请重试。':error.message.startsWith('Failed to fetch')?'本地面板未运行':error.message;
        errors.push(provider);
        await chrome.storage.local.set({[provider]:{status:'error',message,at:new Date().toISOString()}});
        const errorCode=error.name==='TimeoutError'?'report-timeout':typeof error.code==='string'?error.code:'report-failed';
        try {await report(token,{provider,status:'error',errorCode});} catch {}
      } finally {
        await releaseTab();
      }
    }));
  } finally {running=false; await chrome.storage.local.set({lastRun:new Date().toISOString()});}
  return {ok:errors.length===0,completed:Object.keys(PROVIDERS).length-errors.length,error:errors.length?'部分网页读取失败，请查看接入状态。':null};
}
// Migrate the previous periodic mode. Nothing is collected on a timer or browser startup.
async function resume(){await chrome.alarms.clear('headroom');await chrome.alarms.create('headroom-link',{periodInMinutes:1});await connectDesktop();}
resume();
chrome.alarms.onAlarm.addListener(resume);
chrome.runtime.onStartup.addListener(resume);
chrome.runtime.onInstalled.addListener(resume);
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(sender.id!==chrome.runtime.id) return;
  if(sender.tab && !['http://127.0.0.1:4317/','http://127.0.0.1:4317/toolbar'].includes(sender.url)) return;
  if(message.type==='refresh') {cycle().then(reply).catch(()=>reply({error:'后台采集未能完成，请重试。'}));return true;}
  if(sender.tab) return;
  if(message.type==='configure') {
    (async()=>{
      if(!/^[a-f0-9]{64}$/.test(message.token||'')) throw new Error('请粘贴面板生成的完整配对码');
      await report(message.token,{provider:'google',status:'paired'});
      await chrome.storage.local.set({token:message.token,enabled:true});
      await chrome.alarms.clear('headroom');
      disconnectDesktop();connectDesktop();reply({ok:true}); cycle();
    })().catch(error=>reply({error:error.message})); return true;
  }
  if(message.type==='pause') {chrome.storage.local.set({enabled:false});disconnectDesktop();chrome.alarms.clear('headroom');reply({ok:true});}
});
