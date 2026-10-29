import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dashboard as quotaDashboard, normalizeTokscale, mergeObservations, createManualObservation, applyAliases, linkQuotaPools } from './lib/quotas.mjs';
import { collect } from './lib/collector.mjs';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {createDesktopBridge} from './lib/desktop-bridge.mjs';
import {desktopCommand,validCollectorId} from './lib/collector-window.mjs';
import {browserFailures} from './lib/refresh-errors.mjs';
import { normalizeBrowser } from './lib/browser.mjs';
import {normalizeClaudeApi,claudeApiView} from './lib/claude-api.mjs';
import {normalizeOpenaiApi,openaiApiView} from './lib/openai-api.mjs';
import {fetchBalance,apiView} from './lib/deepseek.mjs';
import {hasDeepseekKey,readDeepseekKey,saveDeepseekKey} from './lib/vault.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.HEADROOM_DATA_DIR || path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const PORT = Number(process.env.PORT || 4317);
await mkdir(DATA_DIR, { recursive:true });
let deepseekConfigured=await hasDeepseekKey(DATA_DIR),deepseekBusy=false;
let desktopBridge,desktopRefresh={status:'idle'};
function dashboard(value){
  const quotas=quotaDashboard(value),api={...apiView(value,deepseekConfigured),claude:claudeApiView(value),openai:openaiApiView(value)};
  const timestamps=[...quotas.pools.map(pool=>pool.observedAt),api.deepseek?.observedAt,api.claude?.observedAt,api.openai?.observedAt].map(Date.parse).filter(Number.isFinite);
  const lastUpdatedAt=timestamps.length?new Date(Math.max(...timestamps)).toISOString():null;
  const previousErrors=browserFailures(value);
  const refresh=desktopRefresh.status==='idle'&&previousErrors.length?{status:'error',error:previousErrors.join('；')}:desktopRefresh;
  return {...quotas,api,lastUpdatedAt,preferences:{theme:['light','dark','system'].includes(value.preferences?.theme)?value.preferences.theme:'system'},desktop:{connected:!!desktopBridge?.connected,refresh}};
}
const KEY_FILE=path.join(DATA_DIR,'browser-key.json');
let browserKey;
try { browserKey=JSON.parse(await readFile(KEY_FILE,'utf8')).key; }
catch(error) { if(error.code!=='ENOENT') throw error; browserKey=randomBytes(32).toString('hex'); await writeFile(KEY_FILE,JSON.stringify({key:browserKey}),{mode:0o600}); }
if(!/^[a-f0-9]{64}$/.test(browserKey)) throw new Error('浏览器配对配置损坏。');
let state;
try { state = JSON.parse(await readFile(STATE_FILE, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw new Error('无法读取 data/state.json；请检查文件，原文件未覆盖。'); state = { version: 1, observations: [], sync: {} }; }
if (state.version !== 1 || !Array.isArray(state.observations)) throw new Error('不支持的数据文件格式，原文件未覆盖。');
let mutations = Promise.resolve();
let syncing = false;
const listeners=new Set();
function publish(){const frame=`data: ${JSON.stringify({...dashboard(state),syncing})}\n\n`;for(const res of listeners)res.write(frame);}

async function save(action) {
  const next = mutations.then(async () => {
    const draft = structuredClone(state);
    await action(draft);
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(`${STATE_FILE}.tmp`, JSON.stringify(draft, null, 2), { mode: 0o600 });
    await rename(`${STATE_FILE}.tmp`, STATE_FILE);
    state = draft;
    publish();
  });
  mutations = next.catch(() => {});
  return next;
}

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('需要 JSON 请求。');
  let chunks = [], size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 2 * 1024 * 1024) throw new Error('文件过大，最大 2 MB。'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const files = new Map([
  ['/', ['toolbar.html', 'text/html']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
  ['/toolbar', ['toolbar.html', 'text/html']], ['/toolbar.js', ['toolbar.js','text/javascript']],
  ['/toolbar.css', ['toolbar.css','text/css']], ['/client.js', ['client.js','text/javascript']],
  ['/reset-time.js',['reset-time.js','text/javascript']],
  ['/api-balances.js',['api-balances.js','text/javascript']], ['/api-balances.css',['api-balances.css','text/css']],
  ['/theme.js',['theme.js','text/javascript']], ['/theme.css',['theme.css','text/css']],
]);
export const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  const hosts = [`127.0.0.1:${PORT}`, `localhost:${PORT}`];
  if (!hosts.includes(req.headers.host)) return json(res, 403, { error: '仅允许本机访问。' });
  const origin = req.headers.origin;
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  // Paired extension may submit reports or hide its own collector window only.
  if(['/api/browser/report','/api/browser/collector'].includes(url.pathname)) {
    if(!/^chrome-extension:\/\/[a-p]{32}$/.test(origin||'')) return json(res,403,{error:'仅接受已配对浏览器扩展。'});
    res.setHeader('Access-Control-Allow-Origin',origin); res.setHeader('Vary','Origin');
    if(req.method==='OPTIONS') {res.setHeader('Access-Control-Allow-Methods','POST');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');res.writeHead(204);return res.end();}
    if(req.method!=='POST') return json(res,405,{error:'仅支持 POST。'});
    const supplied=req.headers.authorization?.replace(/^Bearer /,'')||'';
    if(!/^[a-f0-9]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied),Buffer.from(browserKey))) return json(res,401,{error:'配对码无效。'});
    try {
      if(url.pathname==='/api/browser/collector') {
        const input=await body(req);
        if(!validCollectorId(input.id)||Object.keys(input).some(key=>key!=='id'))return json(res,400,{error:'无效的采集窗口。'});
        if(PORT!==4317||process.platform!=='win32')return json(res,503,{error:'隐藏采集仅支持 Windows 本机服务。'});
        await desktopCommand(ROOT,['--hide-collector',input.id]);
        return json(res,200,{ok:true});
      }
      const input=await body(req); const isClaudeApi=input.provider==='claude-api',isOpenaiApi=input.provider==='openai-api';
      const balance=isClaudeApi?normalizeClaudeApi(input):isOpenaiApi?normalizeOpenaiApi(input):null;
      const observations=isClaudeApi||isOpenaiApi?[]:normalizeBrowser(input);
      await save(draft=>{
        draft.browser ||= {};
        const previous=draft.browser[input.provider]||{};
        const reasons={'receiver-missing':'页面没有接收到采集请求；扩展脚本尚未加载。','receiver-disconnected':'页面正在跳转，采集连接已中断。','probe-timeout':'页面采集请求在 30 秒内没有响应。','probe-failed':'浏览器拒绝或无法完成页面采集请求。','parser-failed':'采集脚本已启动，但解析页面时出错。','script-unavailable':'页面采集脚本未就绪，请检查登录或重新加载扩展。','tab-closed':'临时采集页再次关闭，自动恢复未完成，请重试。','wrong-page':'页面跳转到了其他地址，请检查登录状态。','identity-missing':'页面账户名称或组织标识尚未读取到。','usage-missing':'用量或账单余额文字尚未读取到。','report-timeout':'向本机提交读数超时，请重试。','report-failed':'采集结果提交失败，请重试。'};
        const detail=Object.hasOwn(reasons,input.errorCode)?reasons[input.errorCode]:'网页采集失败，请检查浏览器登录和扩展状态。';
        draft.browser[input.provider]={...previous,status:input.status,attemptedAt:new Date().toISOString(),error:input.status==='error'?detail:input.status==='ok'?null:previous.error||null};
        if(input.status==='ok') {
          if(isOpenaiApi) {
            draft.api||={};draft.api.openai=balance;
            draft.browser[input.provider].completedAt=input.observedAt;
            return;
          }
          if(isClaudeApi) {
            draft.api||={};draft.api.claude||={accounts:[]};
            draft.api.claude.accounts=[...draft.api.claude.accounts.filter(a=>a.accountKey!==balance.accountKey),balance];
            draft.browser[input.provider].completedAt=input.observedAt;
            return;
          }
          draft.browser[input.provider].authoritative=true;
          draft.browser[input.provider].completedAt=input.observedAt;
          const incoming=applyAliases(observations,draft);
          draft.observations=mergeObservations(draft.observations,incoming);
          draft.browser[input.provider].receivedPoolIds=incoming.map(o=>o.poolId);
        }
      });
      return json(res,200,{ok:true});
    }catch(error){return json(res,400,{error:error.message});}
  }
  const publicNavigation=req.method==='GET' && (files.has(url.pathname)||url.pathname==='/collector') && req.headers['sec-fetch-mode']==='navigate';
  if (!publicNavigation && ((origin && !hosts.some(h => origin === `http://${h}`)) || req.headers['sec-fetch-site'] === 'cross-site')) return json(res, 403, { error: '不允许跨站请求。' });
  try {
    if(req.method==='GET'&&url.pathname==='/collector') {
      const id=url.searchParams.get('id');
      if(!validCollectorId(id))return json(res,400,{error:'无效的采集窗口。'});
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
      return res.end(`<!doctype html><title>AIHUD-Collector-${id}</title><p>后台额度采集</p>`);
    }
    if (req.method === 'GET' && url.pathname === '/api/dashboard') return json(res, 200, { ...dashboard(state), syncing });
    if(req.method==='GET' && url.pathname==='/api/events') {
      if(listeners.size>=16)return json(res,429,{error:'面板连接过多。'});
      res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache','Connection':'keep-alive'});
      listeners.add(res);res.write(`data: ${JSON.stringify({...dashboard(state),syncing})}\n\n`);
      const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),25000);
      req.on('close',()=>{clearInterval(heartbeat);listeners.delete(res);});return;
    }
    if (req.method === 'POST' && req.headers['x-headroom-client'] !== 'local') return json(res, 403, { error: '请求来源无效。' });
    if(req.method==='POST' && url.pathname==='/api/desktop/settings') {
      const input=await body(req);
      if(Object.keys(input).length)return json(res,400,{error:'设置入口不接受额外参数。'});
      if(process.platform!=='win32')return json(res,400,{error:'桌面设置仅支持 Windows。'});
      const child=spawn(path.join(ROOT,'Headroom.exe'),['--settings'],{cwd:ROOT,windowsHide:true,stdio:'ignore'});
      await once(child,'spawn');child.unref();return json(res,202,{opened:true});
    }
    if(req.method==='POST' && url.pathname==='/api/desktop/refresh') {
      await body(req);
      if(desktopRefresh.status==='running')return json(res,409,{error:'后台正在刷新，请稍候。'});
      if(!desktopBridge.connected){
        if(PORT!==4317||process.platform!=='win32')return json(res,503,{error:'浏览器后台未连接。'});
        try{await desktopCommand(ROOT,['--wake-browser']);}catch{return json(res,503,{error:'无法启动后台 Edge。'});}
        for(let i=0;i<40&&!desktopBridge.connected;i++)await new Promise(resolve=>setTimeout(resolve,250));
        if(!desktopBridge.connected)return json(res,503,{error:'后台 Edge 尚未连接，请确认扩展已开启并完成配对。'});
        if(desktopRefresh.status==='running')return json(res,409,{error:'后台正在刷新，请稍候。'});
      }
      if(desktopRefresh.startedAt&&Date.now()-Date.parse(desktopRefresh.startedAt)<60000)return json(res,429,{error:'请间隔至少 1 分钟再刷新。'});
      const jobId=randomUUID();desktopRefresh={id:jobId,status:'running',startedAt:new Date().toISOString(),error:null};publish();
      const local=async route=>{const response=await fetch(`http://127.0.0.1:${PORT}${route}`,{method:'POST',headers:{'Content-Type':'application/json','X-Headroom-Client':'local'},body:'{}',signal:AbortSignal.timeout(150000)});const result=await response.json();if(!response.ok)throw Error(result.error||'读取失败');return result;};
      Promise.allSettled([local('/api/sync'),local('/api/deepseek/sync'),desktopBridge.refresh(jobId)]).then(results=>{
        const labels=['Codex','DeepSeek API','网页采集'];
        const errors=results.flatMap((result,index)=>{
          const error=result.status==='rejected'?result.reason.message:result.value?.error;
          if(!error)return [];
          const details=index===2?browserFailures(state,desktopRefresh.startedAt):[];
          return details.length?details:[`${labels[index]}：${error}`];
        });
        desktopRefresh={...desktopRefresh,status:errors.length?'error':'ok',finishedAt:new Date().toISOString(),error:errors.join('；')||null};publish();
      });
      return json(res,202,{desktop:{connected:true,refresh:desktopRefresh}});
    }
    if(req.method==='POST' && url.pathname==='/api/preferences') {
      const input=await body(req);
      if(!['light','dark','system'].includes(input.theme) || Object.keys(input).some(key=>key!=='theme')) return json(res,400,{error:'无效的外观设置。'});
      await save(draft=>{draft.preferences={...draft.preferences,theme:input.theme};});
      return json(res,200,{preferences:dashboard(state).preferences});
    }
    if(req.method==='POST' && ['/api/deepseek/connect','/api/deepseek/sync'].includes(url.pathname)) {
      const input=await body(req);
      if(deepseekBusy)return json(res,409,{error:'DeepSeek 正在更新，请稍候。'});
      const connecting=url.pathname.endsWith('/connect');
      if(!connecting&&!deepseekConfigured)return json(res,200,{skipped:true});
      if(connecting&&process.env.DEEPSEEK_API_KEY)return json(res,400,{error:'当前使用环境变量中的密钥，请在环境变量中更换。'});
      deepseekBusy=true;
      try{
        const key=connecting?(typeof input.key==='string'?input.key.trim():''):await readDeepseekKey(ROOT,DATA_DIR);
        if(!connecting)await save(draft=>{draft.api||={};draft.api.deepseek={...draft.api.deepseek,status:'collecting',attemptedAt:new Date().toISOString()};});
        const balance=await fetchBalance(key);
        if(connecting){await saveDeepseekKey(ROOT,DATA_DIR,key);deepseekConfigured=true;}
        await save(draft=>{draft.api||={};draft.api.deepseek={...balance,status:'ok',error:null,attemptedAt:new Date().toISOString()};});
        return json(res,200,dashboard(state));
      }catch(error){
        if(!connecting)await save(draft=>{draft.api||={};draft.api.deepseek={...draft.api.deepseek,status:'error',error:error.message};});
        return json(res,502,{error:error.message});
      }finally{deepseekBusy=false;}
    }
    if(req.method==='POST' && url.pathname==='/api/browser/pairing') {await body(req);return json(res,200,{key:browserKey});}
    if (req.method === 'POST' && url.pathname === '/api/sync') {
      await body(req);
      if (syncing) return json(res, 409, { error: '正在同步，请稍候。' });
      if (state.sync.attemptedAt && Date.now() - Date.parse(state.sync.attemptedAt) < 60000) return json(res, 429, { error: '请间隔至少 1 分钟再同步。' });
      syncing = true;
      try {
        await save(draft => { draft.sync = { ...draft.sync, attemptedAt: new Date().toISOString() }; });
        const raw = await collect(ROOT);
        const selected=raw.filter(row=>!state.browser?.[{'Claude':'anthropic','Grok':'xai'}[row.provider]]?.authoritative);
        const { observations, skipped } = normalizeTokscale(selected);
        await save(draft => {
          const incoming = applyAliases(observations, draft);
          draft.observations = mergeObservations(draft.observations, incoming);
          draft.sync = { ...draft.sync, completedAt: new Date().toISOString(), error: null, received: observations.length, skipped,
            receivedPoolIds: incoming.map(o => o.poolId),
            message: observations.length ? `已读取 ${observations.length} 条额度记录；未返回的平台仍需接入。` : '没有返回可用额度。请检查 Codex / Claude / Grok 登录状态；之前的记录已保留。' };
        });
        return json(res, 200, dashboard(state));
      } catch (error) {
        await save(draft => { draft.sync.error = error.message; });
        return json(res, 502, { error: error.message });
      } finally { syncing = false; publish(); }
    }
    if (req.method === 'POST' && url.pathname === '/api/import') {
      const input = await body(req);
      if (!input.observedAt || !Number.isFinite(Date.parse(input.observedAt)) || Date.parse(input.observedAt) > Date.now() + 60000) throw new Error('请选择文件实际采集时间。');
      const { observations, skipped } = normalizeTokscale(input.data, input.observedAt, 'tokscale-import');
      if (!observations.length) throw new Error('文件中没有这四个订阅的可识别额度记录。');
      await save(draft => { draft.observations = mergeObservations(draft.observations, applyAliases(observations, draft)); });
      return json(res, 200, { ...dashboard(state), importResult: { count: observations.length, skipped } });
    }
    if (req.method === 'POST' && url.pathname === '/api/manual') {
      const input = await body(req);
      await save(draft => { draft.observations = mergeObservations(draft.observations, [createManualObservation(input, draft.observations)]); });
      return json(res, 200, dashboard(state));
    }
    if (req.method === 'POST' && url.pathname === '/api/link') {
      const input = await body(req);
      await save(draft => linkQuotaPools(draft, input));
      return json(res, 200, dashboard(state));
    }
    if (req.method === 'GET' && files.has(url.pathname)) {
      const [filename, type] = files.get(url.pathname);
      const content = await readFile(path.join(ROOT, 'public', filename));
      res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-cache' });
      return res.end(content);
    }
    json(res, 404, { error: '未找到此页面。' });
  } catch (error) { json(res, 400, { error: error instanceof SyntaxError ? 'JSON 文件格式无效。' : error.message }); }
});
desktopBridge=createDesktopBridge(server,{token:browserKey,port:PORT,onChange:publish});
server.listen(PORT, '127.0.0.1', () => console.log(`AI head-up dispaly ready at http://127.0.0.1:${PORT}`));
