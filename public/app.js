import { demoDashboard } from './demo.js';
import {request,refreshBrowser,subscribeDashboard} from './client.js';
import {mountApiBalances} from './api-balances.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let live = null, data = null, isDemo = false, busy = false, view = 'overview', filter = 'all', importData = null;
let toastTimer;
const apiBalances=mountApiBalances('#api-balances',{disabled:()=>isDemo,onUpdated:value=>{live=value;if(!isDemo){data=live;render();}toast('DeepSeek 已连接，余额已读取。');}});
const statusLabels = { fresh: '已更新', stale: '待更新', expired: '已到重置时间', unknown: '数值未知', conflict: '读数有冲突' };
const windowLabels = { 'Weekly': '每周额度', 'Session': '当前周期', 'Session (5hr)': '5 小时额度', 'Monthly': '每月额度', 'Daily': '每日额度' };
const label = window => windowLabels[window] || window;
const dateFormat = (time, full = false) => time ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Europe/Madrid', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', ...(full ? { year: 'numeric' } : {}) }).format(new Date(time)) : '未提供';
const number = value => value === null ? '—' : Number(value.toFixed(1)).toString();
function until(time) {
  if (!time) return '重置时间未知';
  const minutes = Math.ceil((Date.parse(time) - Date.now()) / 60000);
  if (minutes <= 0) return '已到重置时间';
  if (minutes < 60) return `${minutes} 分钟后`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分后`;
  return `${Math.floor(minutes / 1440)} 天 ${Math.floor(minutes % 1440 / 60)} 小时后`;
}
function age(time) {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(time)) / 60000));
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`;
  return `${Math.floor(minutes / 1440)} 天前`;
}
function localInput(time = new Date()) {
  const date = new Date(time);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function toast(message) {
  clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 6500);
}
function providerFor(id) { return data.providers.find(p => p.id === id); }
function poolsFor(id) { return data.pools.filter(p => p.provider === id); }
function setView(next) {
  view = next;
  $$('.view').forEach(el => { el.hidden = el.id !== `view-${view}`; });
  $$('[data-view]').forEach(el => { el.classList.toggle('active', el.dataset.view === view); el.setAttribute('aria-current', el.dataset.view === view ? 'page' : 'false'); });
}
function poolHTML(pool) {
  const state = statusLabels[pool.status];
  const fresh = pool.status === 'fresh';
  return `<button class="pool-button ${escape(pool.status)}" style="--quota-progress:${pool.remaining ?? 0}%" data-pool="${escape(pool.poolId)}" aria-label="查看 ${escape(label(pool.window))} 的来源和详情">
    <div class="pool-label-row"><span class="pool-title">${escape(label(pool.window))}<small>${escape(pool.scopeLabel)}</small></span><span class="pool-number">${number(pool.remaining)}${pool.remaining === null ? '' : '<small>%</small>'}</span></div>
    <div class="meter" role="meter" aria-label="${escape(label(pool.window))} ${fresh ? '剩余额度' : '上次记录'}" ${pool.remaining === null ? 'aria-valuetext="未知"' : `aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pool.remaining}"`}><div class="meter-fill" style="--fill:${pool.remaining ?? 0}%"></div></div>
    <div class="pool-meta"><span>${fresh ? '剩余' : escape(state) + ' · 上次记录'} · ${escape(until(pool.resetsAt))}</span><span>详情 ↗</span></div></button>`;
}
function cardHTML(provider) {
  const pools = poolsFor(provider.id);
  const fresh = pools.filter(p => p.status === 'fresh');
  const overallStatus = !pools.length ? 'unknown' : fresh.length === pools.length ? 'fresh' : pools.some(p => p.status === 'conflict') ? 'conflict' : 'stale';
  const collecting=provider.id==='openai'?data.syncing:data.browser?.[provider.id]?.status==='collecting';
  const badge = collecting?'后台更新中…':!pools.length ? '尚未接入' : overallStatus === 'fresh' ? `${pools.length} 个额度周期` : '部分读数待更新';
  const accounts = [...new Set(pools.map(p => p.accountKey))];
  let content;
  if (pools.length) {
    content = accounts.map(accountKey => {
      const group = pools.filter(p => p.accountKey === accountKey);
      const scopes = [...new Set(group.map(p => p.scope))];
      return `<div class="account-label">◎ ${escape(group[0].accountLabel)}${!group[0].identityVerified ? '<span class="unknown-note">· 不跨来源自动合并</span>' : ''}</div>` + scopes.map(scope => {
        const scoped = group.filter(p => p.scope === scope);
        const channels = [...new Set(scoped.flatMap(p => p.channels))];
        return scoped.map(poolHTML).join('') + `<div class="channel-tags">${channels.map(channel => `<span>${escape(channel)}</span>`).join('')}${channels.length > 1 ? '<span class="shared-tag">此范围共享 · 不重复计数</span>' : ''}</div>`;
      }).join('');
    }).join('');
    if (provider.id === 'openai') content += '<p class="provider-footnote">当前显示 Codex / 已记录功能。ChatGPT 其他功能额度需分别核对。</p>';
  } else {
    content = `<div class="empty-meter"><div class="empty-value">—<span>等待读数</span></div><div class="empty-track"></div><p>${escape(provider.description)}。<br>未读取的额度保持未知。</p><button class="inline-action" data-view="connections">连接自动采集 ↗</button></div>`;
  }
  const latest = pools.toSorted((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
  return `<article class="provider-card" style="--accent:${provider.color}"><div class="provider-top"><div class="provider-symbol" aria-hidden="true">${provider.letter}</div><div><h2 class="provider-name">${provider.name}</h2><p class="provider-plan">${escape(provider.plan)}</p></div><span class="status-badge ${overallStatus}">${badge}</span></div><div class="provider-body">${content}</div><div class="provider-bottom"><span>${latest ? `${escape(latest.sourceLabel)} · ${escape(age(latest.observedAt))}` : '尚未取得可验证的数据'}</span><a href="${provider.url}" target="_blank" rel="noopener noreferrer">打开 ${provider.name} ↗</a></div></article>`;
}
function renderStats() {
  const next = data.pools.filter(p => p.status === 'fresh' && p.resetsAt && Date.parse(p.resetsAt) > Date.now()).toSorted((a, b) => Date.parse(a.resetsAt) - Date.parse(b.resetsAt))[0];
  $('#overview-stats').innerHTML = [
    ['我的订阅', '04', '个订阅'], ['已更新额度', String(data.stats.fresh).padStart(2, '0'), '个独立周期'],
    ['待接入 / 更新', String(4 - data.stats.connected).padStart(2, '0'), '个平台'], ['下次重置', next ? until(next.resetsAt).replace('后', '') : '待确认', next ? providerFor(next.provider).name : '需要有效读数'],
  ].map(([title, value, unit]) => `<div class="stat"><div class="stat-caption">${title}</div><div class="stat-value">${escape(value)}<small>${escape(unit)}</small></div></div>`).join('');
}
function renderCards() {
  const providers = data.providers.filter(p => filter === 'all' || (filter === 'pending' ? !poolsFor(p.id).some(pool => pool.status === 'fresh') : data.recommendations.some(id => poolsFor(p.id).some(pool => pool.poolId === id))));
  $('#provider-cards').innerHTML = providers.length ? providers.map(cardHTML).join('') : '<p class="empty-filter">目前没有符合条件的订阅。</p>';
  $$('.filter').forEach(button => { button.classList.toggle('active', button.dataset.filter === filter); button.setAttribute('aria-pressed', button.dataset.filter === filter ? 'true' : 'false'); });
}
function renderRecommendations() {
  const items = data.recommendations.map(id => data.pools.find(p => p.poolId === id)).filter(Boolean).slice(0, 2);
  $('#recommendations').innerHTML = items.length ? items.map(p => `<div class="recommendation"><strong>${providerFor(p.provider).name} · 还有 ${number(p.remaining)}%</strong><p>${escape(label(p.window))} ${escape(until(p.resetsAt))}重置。如果任务适合，可以优先使用。</p><button data-pool="${escape(p.poolId)}">核对额度与来源 ↗</button></div>`).join('') : '<div class="recommendation"><strong>暂时没有优先使用提示</strong><p>有新鲜读数、24 小时内重置且剩余 ≥ 40% 时，这里会提示你。</p></div>';
  const resets = data.pools.filter(p => p.status === 'fresh' && p.resetsAt && Date.parse(p.resetsAt) > Date.now() && Date.parse(p.resetsAt) - Date.now() <= 86400000).toSorted((a, b) => Date.parse(a.resetsAt) - Date.parse(b.resetsAt));
  $('#reset-list').innerHTML = resets.length ? resets.slice(0, 5).map(p => `<div class="reset-item" style="--accent:${providerFor(p.provider).color}"><i></i><div>${providerFor(p.provider).name}<small>${escape(label(p.window))}</small></div><time>${escape(until(p.resetsAt))}</time></div>`).join('') : '<p class="reset-empty">未来 24 小时内暂无已确认的重置。<br>未知或过期读数不会参与排序。</p>';
}
function renderRelationships() {
  $('#relationships').innerHTML = data.providers.map(provider => {
    const pools = poolsFor(provider.id);
    if (!pools.length) return `<article class="relation-row" style="--accent:${provider.color}"><div class="relation-provider"><h3>${provider.name}</h3><p>尚未接入</p></div><div class="relation-sources"><span class="relation-source">${provider.name} 网页版</span></div><span class="relation-arrow">⋯</span><div class="relation-pool"><b>等待验证额度关系</b><p>${escape(provider.description)}</p></div></article>`;
    const groups = new Map();
    for (const p of pools) { const key = `${p.accountKey}:${p.scope}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(p); }
    return [...groups.values()].map(group => `<article class="relation-row" style="--accent:${provider.color}"><div class="relation-provider"><h3>${provider.name}</h3><p>${escape(group[0].accountLabel)}</p></div><div class="relation-sources">${[...new Set(group.flatMap(p => p.channels))].map(c => `<span class="relation-source">${escape(c)}</span>`).join('')}</div><span class="relation-arrow">→</span><div class="relation-pool"><b>${escape(group[0].scopeLabel)} · ${group.length} 个周期</b><p>${group.map(p => `${escape(label(p.window))} ${number(p.remaining)}%`).join(' / ')}</p><p>${escape(group[0].rule)}</p><button class="inline-action" data-pool="${escape(group[0].poolId)}">查看来源 / 关联重复记录 ↗</button></div></article>`).join('');
  }).join('');
}
function render() {
  if (!data) return;
  renderStats(); renderCards(); renderRecommendations(); renderRelationships();
  apiBalances.render(data.api?.deepseek,data.api?.claude);
  $('#demo-banner').hidden = !isDemo;
  $('#demo-toggle').textContent = isDemo ? '返回真实数据' : '查看示例';
  const sync = data.sync || {};
  $('#browser-status').innerHTML = Object.entries({anthropic:'Claude',xai:'Grok',google:'Gemini','claude-api':'Claude API'}).map(([id,name])=>{const c=data.browser?.[id];return `<p class="fine-print">${name} · ${escape(c?.error || (c?.status==='collecting'?'正在读取':c?.completedAt?`上次成功 ${age(c.completedAt)}`:'等待扩展配对'))}</p>`;}).join('');
  $('#sync-status').innerHTML = `<p class="sync-message ${sync.error ? 'error' : ''}">${escape(sync.error || sync.message || '尚未同步。点击后读取本机已登录的订阅额度。')}${sync.attemptedAt ? `<br>最近尝试：${dateFormat(sync.attemptedAt)}` : ''}</p>`;
  $('#footer-status').textContent = isDemo ? 'DEMO / 示例数据 · 不会保存' : `${data.pools.length} 个额度周期 · 数据仅保存在本机`;
  setView(view);
}
async function load() {
  try { live = await request('/api/dashboard'); if (!isDemo) { data = live; render(); } }
  catch (error) { toast(`无法读取面板：${error.message}`); $('#footer-status').textContent = '本地服务连接失败'; }
}
async function sync() {
  if (isDemo) return toast('当前是示例模式，请返回真实数据后同步。');
  if (busy) return;
  busy = true; $('#refresh').disabled = true; $('#connection-sync').disabled = true;
  $('#refresh-icon').classList.add('spinning'); $('#refresh-label').textContent = '读取中…';
  const progressTimer=setInterval(load,2000);
  try {
    const results=await Promise.allSettled([request('/api/sync', {}),refreshBrowser(),request('/api/deepseek/sync',{})]);
    await load();
    const errors=results.flatMap(result=>result.status==='rejected'?[result.reason.message]:result.value?.error?[result.value.error]:[]);
    toast(errors.length?errors.join('；'):'已连接的订阅与 API 余额已完成后台更新。');
  }
  catch (error) { toast(error.message); await load(); }
  finally { clearInterval(progressTimer);busy = false; $('#refresh').disabled = false; $('#connection-sync').disabled = false; $('#refresh-icon').classList.remove('spinning'); $('#refresh-label').textContent = '同步额度'; }
}
function toggleDemo() {
  if (!live) return toast('尚未连接本地服务，请先刷新页面。');
  isDemo = !isDemo;
  data = isDemo ? demoDashboard(live.providers) : live;
  render();
}
function updateTargets(selected = '') {
  const providerId = $('#manual-provider').value;
  const targets = live.pools.filter(p => p.provider === providerId);
  $('#manual-target').innerHTML = '<option value="">新建独立额度池</option>' + targets.map(p => `<option value="${escape(p.poolId)}">${escape(p.accountLabel)} · ${escape(p.scopeLabel)} · ${escape(label(p.window))}</option>`).join('');
  $('#manual-target').value = selected;
  updateManualFields();
}
function updateManualFields() {
  const linked = !!$('#manual-target').value;
  $('#manual-new-fields').hidden = linked; $('#shared-confirm-row').hidden = !linked;
  for (const name of ['accountLabel', 'scopeLabel', 'window']) $('#manual-form').elements[name].required = !linked;
  $('#manual-form').elements.confirmShared.checked = false;
  $('#manual-form').elements.confirmShared.required = linked;
}
function openManual(providerId = 'google', target = '') {
  if (!live) return toast('尚未连接本地服务，请先刷新页面。');
  if (isDemo) return toast('示例数据不会保存。请先返回真实数据。');
  const form = $('#manual-form'); form.reset(); $('#manual-error').textContent = '';
  $('#manual-provider').innerHTML = live.providers.map(p => `<option value="${p.id}">${p.name} · ${escape(p.plan)}</option>`).join('');
  $('#manual-provider').value = providerId;
  form.elements.observedAt.value = localInput();
  form.elements.scopeLabel.value = { google: 'Gemini Apps', xai: 'Grok 订阅', anthropic: 'Claude 订阅', openai: 'ChatGPT 其他功能' }[providerId];
  updateTargets(target); $('#manual-dialog').showModal();
}
function openDetail(id) {
  const pool = data.pools.find(p => p.poolId === id); if (!pool) return;
  const provider = providerFor(pool.provider);
  const candidates = data.pools.filter(p => p.provider === pool.provider && p.poolId !== id);
  $('#detail-content').innerHTML = `<div class="dialog-heading"><div><span class="eyebrow">${provider.name.toUpperCase()} / QUOTA POOL</span><h2>${escape(label(pool.window))}</h2></div><button class="close-button" data-close aria-label="关闭">×</button></div><div class="detail-number">${number(pool.remaining)}${pool.remaining === null ? '' : '<small>% 剩余</small>'}</div><span class="status-badge ${pool.status}">${statusLabels[pool.status]}${pool.evidence === 'manual' ? ' · 人工记录' : ''}</span><dl class="detail-definition"><dt>账户</dt><dd>${escape(pool.accountLabel)}${pool.identityVerified ? '' : '（身份未返回，不自动关联其他来源）'}</dd><dt>功能范围</dt><dd>${escape(pool.scopeLabel)}</dd><dt>实际读数时间</dt><dd>${dateFormat(pool.observedAt, true)} · ${escape(age(pool.observedAt))}</dd><dt>重置时间</dt><dd>${dateFormat(pool.resetsAt, true)}</dd><dt>当前来源</dt><dd>${escape(pool.sourceLabel)}</dd><dt>关联入口</dt><dd>${pool.channels.map(escape).join('、')}</dd><dt>采集套餐标识</dt><dd>${escape(pool.plan || '来源未返回')}</dd></dl><p class="detail-note">${escape(pool.rule)} ${pool.sourceCount > 1 ? `已关联 ${pool.sourceCount} 种来源，同一池取最新读数，不相加。` : ''}</p><h3 style="font-size:13px;margin-top:24px;font-weight:500">最近观测 · 不等于累计消耗</h3><table class="history-table"><thead><tr><th>观测时间</th><th>剩余</th><th>来源</th></tr></thead><tbody>${pool.history.slice(-6).reverse().map(h => `<tr><td>${dateFormat(h.observedAt)}</td><td>${number(h.remaining)}${h.remaining === null ? '' : '%'}</td><td>${escape(h.sourceLabel)}</td></tr>`).join('')}</tbody></table>${!isDemo && candidates.length ? `<details style="margin-top:20px;font-size:12px"><summary>另一条记录其实是这个共享额度？</summary><p class="fine-print" style="margin:10px 0">只有同账户、同功能范围、同周期才能关联。不同周期禁止合并；不能撤销的原始导入请先保留。</p><form id="link-form"><input type="hidden" name="fromPoolId" value="${escape(id)}"><label>合并到已有额度池<select name="toPoolId">${candidates.map(p => `<option value="${escape(p.poolId)}">${escape(p.accountLabel)} · ${escape(p.scopeLabel)} · ${escape(label(p.window))}</option>`).join('')}</select></label><label class="confirm-row"><input type="checkbox" name="confirm" required>我已核实是同一账户、同一功能和周期，保留最新读数。</label><p id="link-error" class="form-error" role="alert"></p><button type="submit" class="button secondary">关联为同一个池</button></form></details>` : ''}<div class="dialog-footer"><a class="button secondary" href="${provider.usageUrl}" target="_blank" rel="noopener noreferrer">打开官方页面 ↗</a><button class="button primary" data-check="${escape(id)}">更新网页读数</button></div>`;
  $('#detail-dialog').showModal();
}

document.addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.dataset.view) setView(button.dataset.view);
  if (button.dataset.filter) { filter = button.dataset.filter; renderCards(); }
  if (button.dataset.pool) openDetail(button.dataset.pool);
  if (button.dataset.manual) openManual(button.dataset.manual);
  if (button.dataset.check) { const pool = data.pools.find(p => p.poolId === button.dataset.check); $('#detail-dialog').close(); openManual(pool.provider, pool.poolId); }
  if (button.hasAttribute('data-close')) button.closest('dialog').close();
});
$('#refresh').addEventListener('click', sync); $('#connection-sync').addEventListener('click', sync);
$('#browser-pair').addEventListener('click',async()=>{
  if(isDemo) return toast('请先退出示例模式。');
  try{const {key}=await request('/api/browser/pairing',{});await navigator.clipboard.writeText(key);toast('配对码已复制。打开 Headroom 扩展，粘贴后点击「配对并开启」。');}
  catch(error){toast(`无法复制配对码：${error.message}`);}
});
$('#demo-toggle').addEventListener('click', toggleDemo); $('#exit-demo').addEventListener('click', toggleDemo);
$('#manual-open').addEventListener('click', () => openManual()); $('#connection-manual').addEventListener('click', () => openManual());
$('#manual-provider').addEventListener('change', () => {
  updateTargets(); $('#manual-form').elements.scopeLabel.value = { google: 'Gemini Apps', xai: 'Grok 订阅', anthropic: 'Claude 订阅', openai: 'ChatGPT 其他功能' }[$('#manual-provider').value];
});
$('#manual-target').addEventListener('change', updateManualFields);
$('#manual-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('[type=submit]'); button.disabled = true;
  try {
    const values = Object.fromEntries(new FormData(form));
    live = await request('/api/manual', { ...values, remaining: Number(values.remaining), confirmShared: form.elements.confirmShared.checked, observedAt: new Date(values.observedAt).toISOString(), resetsAt: values.resetsAt ? new Date(values.resetsAt).toISOString() : null });
    data = live; render(); $('#manual-dialog').close(); toast('已保存。同一额度池已更新，没有重复计数。');
  } catch (error) { $('#manual-error').textContent = error.message; } finally { button.disabled = false; }
});
document.addEventListener('submit', async event => {
  if (event.target.id !== 'link-form') return;
  event.preventDefault(); const form = event.target; const button = form.querySelector('[type=submit]'); button.disabled = true;
  try {
    const values = Object.fromEntries(new FormData(form));
    live = await request('/api/link', { ...values, confirm: form.elements.confirm.checked }); data = live;
    $('#detail-dialog').close(); render(); toast('已合并为同一额度池，并保留各来源的观测记录。');
  } catch (error) { $('#link-error').textContent = error.message; } finally { button.disabled = false; }
});
$('#import-open').addEventListener('click', () => { if (isDemo) return toast('请先返回真实数据。'); $('#import-file').click(); });
$('#import-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('文件超过 2 MB。');
    importData = JSON.parse(await file.text()); $('#import-filename').textContent = file.name;
    $('#import-time').value = localInput(file.lastModified); $('#import-error').textContent = '';
    $('#import-dialog').showModal();
  } catch (error) { toast(`无法导入：${error.message}`); }
  event.target.value = '';
});
$('#import-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.currentTarget.querySelector('[type=submit]'); button.disabled = true;
  try {
    live = await request('/api/import', { data: importData, observedAt: new Date($('#import-time').value).toISOString() });
    data = live; render(); $('#import-dialog').close(); toast(`导入 ${live.importResult.count} 条观测，同一池不会累加。`);
  } catch (error) { $('#import-error').textContent = error.message; } finally { button.disabled = false; }
});
localStorage.removeItem('headroom-auto-refresh');
function updateClock() { $('#clock').textContent = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' }).format(new Date()) + ' MADRID'; }
updateClock(); setInterval(updateClock, 30000);
setInterval(() => { if (!document.hidden && !busy && !$('dialog[open]')) { if (isDemo) { data = demoDashboard(live.providers); render(); } else load(); } }, 60000);
await load();
subscribeDashboard(value=>{live=value;if(!isDemo){data=live;render();}});
