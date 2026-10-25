import { createHash, randomUUID } from 'node:crypto';

export const PROVIDERS = [
  { id: 'openai', name: 'ChatGPT', plan: 'Pro', color: '#83b7a4', letter: 'O', url: 'https://chatgpt.com', usageUrl: 'https://chatgpt.com/codex/settings/usage', description: 'Codex 额度与 ChatGPT 其他功能分别核对' },
  { id: 'anthropic', name: 'Claude', plan: 'Max', color: '#d9a182', letter: '✳', url: 'https://claude.ai', usageUrl: 'https://claude.ai/settings/usage', description: '同账户下，Claude 网页版与 Claude Code 共享' },
  { id: 'xai', name: 'Grok', plan: '套餐待确认', color: '#b7bdca', letter: '𝕏', url: 'https://grok.com', usageUrl: 'https://grok.com', description: '以账户 Usage 页的额度范围为准' },
  { id: 'google', name: 'Gemini', plan: 'Google AI Pro · 待核对', color: '#a0b3df', letter: '✦', url: 'https://gemini.google.com', usageUrl: 'https://gemini.google.com', description: 'Gemini Apps 额度，独立于 CLI Token 统计' },
];

export const STALE_MS = 15 * 60 * 1000;
export const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 24);
const clean = (value, max = 140) => typeof value === 'string' ? value.trim().slice(0, max) : '';
export function isoDate(value) {
  if (typeof value !== 'string' || !value || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function percent(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

export function readRemaining(metric) {
  const remaining = percent(metric.remaining_percent);
  const used = percent(metric.used_percent);
  if (remaining !== null && used !== null && Math.abs(remaining + used - 100) > 1) return null;
  return remaining ?? (used === null ? null : 100 - used);
}

const ADAPTERS = {
  codex: { provider: 'openai', scope: 'codex', scopeLabel: 'Codex / Work', channels: ['Codex CLI', 'Codex 桌面', 'Codex 云端'], rule: '同一账户的 Codex 使用入口；不推定涵盖全部 ChatGPT 功能。' },
  claude: { provider: 'anthropic', scope: 'claude-subscription', scopeLabel: 'Claude 订阅', channels: ['Claude 网页版', 'Claude Code'], rule: '同一订阅账户的 Claude 与 Claude Code 共享；不同周期仍分别显示。' },
  grok: { provider: 'xai', scope: 'grok', scopeLabel: 'Grok 订阅', channels: ['Grok'], rule: '以提供方返回的账户额度为准，其他产品关联需另行核实。' },
};

export function normalizeTokscale(raw, observedAt = new Date().toISOString(), source = 'tokscale') {
  const time = isoDate(observedAt);
  if (!time) throw new Error('无效的采集时间。');
  if (!Array.isArray(raw)) throw new Error('需要 tokscale usage --json 导出的数组，不能使用 Token 统计报表。');
  if (raw.length > 100) throw new Error('导入的账户数量过多。');
  const observations = [];
  const batchId = randomUUID();
  let skipped = 0;
  raw.forEach((row, index) => {
    if (!row || typeof row !== 'object') throw new Error('额度记录格式无效。');
    const adapterName = clean(row.provider).toLowerCase();
    const adapter = ADAPTERS[adapterName];
    if (!adapter) { skipped++; return; }
    if (!Array.isArray(row.metrics) || row.metrics.length > 60) throw new Error('额度记录缺少有效的 metrics。');
    const accountId = clean(row.account?.id, 250);
    const email = clean(row.email, 250).toLowerCase();
    // ID and email are different identity namespaces. Never guess that two accounts match.
    const identity = accountId ? `id:${accountId}` : email ? `email:${email}` : null;
    // Anonymous data is isolated per collection. Do not silently carry identity across logins.
    const accountKey = identity ? hash(`${adapter.provider}:${identity}`) : `unverified-${hash(`${batchId}:${index}`)}`;
    const accountLabel = clean(row.account?.label, 60) || (email ? `${email.slice(0, 2)}•••@${email.split('@')[1] || '账户'}` : identity ? `账户 ${accountKey.slice(0, 6)}` : '当前登录 · 身份未返回');
    for (const metric of row.metrics) {
      if (!metric || !clean(metric.label)) throw new Error('额度周期缺少名称。');
      const window = clean(metric.label, 100);
      const poolId = hash(`${adapter.provider}|${accountKey}|${adapter.scope}|${window.toLowerCase()}`);
      observations.push({
        id: randomUUID(), poolId, provider: adapter.provider, accountKey, accountLabel,
        identityVerified: !!identity, scope: adapter.scope, scopeLabel: adapter.scopeLabel,
        window, plan: clean(row.plan, 80) || null, channels: adapter.channels, rule: adapter.rule,
        remaining: readRemaining(metric), resetsAt: isoDate(metric.resets_at), observedAt: time,
        source, sourceLabel: source === 'tokscale-import' ? 'Tokscale 文件导入' : 'Tokscale 实时读取',
        evidence: 'provider', batchId,
      });
    }
  });
  return { observations, skipped };
}

export function mergeObservations(existing, incoming) {
  if (!incoming.length) return existing;
  // Anonymous results replace anonymous results of this provider/source, without merging histories.
  const replacementKeys = new Set(incoming.filter(o => !o.identityVerified).map(o => `${o.provider}|${o.source}`));
  const retained = existing.filter(o => o.identityVerified || !replacementKeys.has(`${o.provider}|${o.source}`));
  const records = new Map();
  for (const o of [...retained, ...incoming]) records.set(`${o.poolId}|${o.source}|${o.observedAt}`, o);
  return [...records.values()].sort((a, b) => a.observedAt.localeCompare(b.observedAt)).slice(-6000);
}

export function buildPools(observations, now = Date.now()) {
  const grouped = new Map();
  for (const o of observations) {
    if (!grouped.has(o.poolId)) grouped.set(o.poolId, []);
    grouped.get(o.poolId).push(o);
  }
  return [...grouped.values()].map(records => {
    records.sort((a, b) => a.observedAt.localeCompare(b.observedAt));
    const current = records.at(-1);
    const expired = current.resetsAt !== null && Date.parse(current.resetsAt) <= now;
    const stale = now - Date.parse(current.observedAt) > STALE_MS;
    const simultaneous = records.filter(o => o.observedAt === current.observedAt);
    const conflict = simultaneous.some(o => o.remaining !== current.remaining || o.resetsAt !== current.resetsAt);
    const status = conflict ? 'conflict' : current.remaining === null ? 'unknown' : expired ? 'expired' : stale ? 'stale' : 'fresh';
    const channels = [...new Set(records.flatMap(o => o.channels))];
    // Every metric is an observation of a pool, NEVER a quantity to add to another observation.
    return { ...current, channels, status, sourceCount: new Set(records.map(o => o.source)).size,
      history: records.slice(-50).map(o => ({ remaining: o.remaining, observedAt: o.observedAt, resetsAt: o.resetsAt, sourceLabel: o.sourceLabel })),
    };
  });
}

export function recommendations(pools, now = Date.now()) {
  return pools.filter(pool => {
    if (pool.status !== 'fresh' || pool.remaining === null || pool.remaining < 40 || !pool.resetsAt) return false;
    const remainingMs = Date.parse(pool.resetsAt) - now;
    if (remainingMs <= 0 || remainingMs > 24 * 3600000) return false;
    // A second exhausted/unknown window for the same scope prevents a misleading recommendation.
    return !pools.some(other => other.accountKey === pool.accountKey && other.scope === pool.scope && other.poolId !== pool.poolId && (other.status !== 'fresh' || other.remaining === null || other.remaining < 10));
  }).sort((a, b) => Date.parse(a.resetsAt) - Date.parse(b.resetsAt));
}

export function createManualObservation(input, existing, now = new Date().toISOString()) {
  const provider = PROVIDERS.find(p => p.id === input.provider);
  if (!provider) throw new Error('请选择有效的平台。');
  if (percent(input.remaining) === null) throw new Error('剩余额度必须是 0 到 100 之间的数字。');
  const observedAt = isoDate(input.observedAt) || now;
  if (Date.parse(observedAt) > Date.parse(now) + 60000) throw new Error('观测时间不能在未来。');
  const resetsAt = input.resetsAt ? isoDate(input.resetsAt) : null;
  if (input.resetsAt && !resetsAt) throw new Error('重置时间无效。');
  if (resetsAt && Date.parse(resetsAt) <= Date.parse(observedAt)) throw new Error('重置时间应晚于观测时间。');
  let base;
  if (input.targetPoolId) {
    const pool = buildPools(existing, Date.parse(now)).find(p => p.poolId === input.targetPoolId);
    if (!pool || pool.provider !== provider.id) throw new Error('目标额度池不存在或属于其他平台。');
    if (input.confirmShared !== true) throw new Error('请确认这是同一账户、同一功能范围和同一额度周期。');
    base = { ...pool };
    delete base.history; delete base.status; delete base.sourceCount;
  } else {
    const accountLabel = clean(input.accountLabel, 60);
    const scopeLabel = clean(input.scopeLabel, 80);
    const window = clean(input.window, 80);
    if (!accountLabel || !scopeLabel || !window) throw new Error('请填写账户标识、功能范围和额度周期。');
    // Manual accounts have their own namespace; identical text cannot collide with authenticated IDs.
    const accountKey = hash(`manual:${provider.id}:${accountLabel.toLowerCase()}`);
    const scope = `manual:${scopeLabel.toLowerCase()}`;
    const poolId = hash(`${provider.id}|${accountKey}|${scope}|${window.toLowerCase()}`);
    base = { provider: provider.id, accountKey, accountLabel, identityVerified: true, poolId, scope, scopeLabel, window, plan: null,
      channels: [`${provider.name} 网页版`], rule: '用户从账户页面记录；共享关系仅在明确关联后建立。' };
  }
  return { ...base, id: randomUUID(), remaining: input.remaining, resetsAt, observedAt,
    source: 'manual-web', sourceLabel: '网页手动核对', evidence: 'manual', channels: base.channels };
}

export function dashboard(state, now = Date.now()) {
  // A browser connection becomes authoritative for this provider. Preserve CLI history,
  // but do not display it as a second shared pool when its identity is unavailable/different.
  const visible=state.observations.filter(o=>!(state.browser?.[o.provider]?.authoritative && ['tokscale','tokscale-import'].includes(o.source)));
  const pools = buildPools(visible, now);
  for (const pool of pools) {
    if(pool.source==='browser' && pool.status==='fresh') {
      const connection=state.browser?.[pool.provider];
      if(connection?.error || (connection?.receivedPoolIds && !connection.receivedPoolIds.includes(pool.poolId))) pool.status='stale';
    }
    if (pool.source !== 'tokscale' || pool.status !== 'fresh') continue;
    const failedAfterObservation = state.sync?.error && Date.parse(state.sync.attemptedAt) >= Date.parse(pool.observedAt);
    const missingAfterObservation = state.sync?.completedAt && Date.parse(state.sync.completedAt) > Date.parse(pool.observedAt) && Array.isArray(state.sync.receivedPoolIds) && !state.sync.receivedPoolIds.includes(pool.poolId);
    if (failedAfterObservation || missingAfterObservation) pool.status = 'stale';
  }
  return { providers: PROVIDERS, pools, recommendations: recommendations(pools, now).map(p => p.poolId),
    sync: state.sync || {}, browser:state.browser || {}, updatedAt: new Date(now).toISOString(),
    stats: { subscriptions: PROVIDERS.length, pools: pools.length, fresh: pools.filter(p => p.status === 'fresh').length,
      connected: new Set(pools.filter(p => p.status === 'fresh').map(p => p.provider)).size },
  };
}

function windowClass(value) {
  const normalized = value.toLowerCase().trim();
  if (/^(weekly|每周|每周额度|周额度)$/.test(normalized)) return 'weekly';
  if (/^(session(?: \(5hr\))?|5 小时额度|5小时|当前周期)$/.test(normalized)) return 'session';
  if (/^(monthly|每月|每月额度)$/.test(normalized)) return 'monthly';
  return normalized;
}

export function applyAliases(observations, state) {
  const aliases = state.aliases || {};
  const pools = buildPools(state.observations);
  return observations.map(observation => {
    let id = observation.poolId;
    const visited = new Set();
    while (aliases[id]) {
      if (visited.has(id)) throw new Error('额度关联存在循环。');
      visited.add(id); id = aliases[id];
    }
    if (id === observation.poolId) return observation;
    const target = pools.find(pool => pool.poolId === id);
    if (!target) return observation;
    return { ...observation, originalPoolId: observation.poolId, poolId: target.poolId,
      accountKey: target.accountKey, accountLabel: target.accountLabel, identityVerified: target.identityVerified,
      scope: target.scope, scopeLabel: target.scopeLabel, window: target.window,
      rule: '用户已核对同一账户、同一功能和周期；多个来源只保留最新读数。' };
  });
}

export function linkQuotaPools(state, input) {
  if (input.confirm !== true) throw new Error('需要确认同一账户、同一功能和同一周期。');
  if (input.fromPoolId === input.toPoolId) throw new Error('请选择另一条重复记录。');
  const pools = buildPools(state.observations);
  const from = pools.find(p => p.poolId === input.fromPoolId), to = pools.find(p => p.poolId === input.toPoolId);
  if (!from || !to) throw new Error('额度池不存在，请重新打开详情。');
  if (from.provider !== to.provider) throw new Error('不同平台的额度不能合并。');
  if (windowClass(from.window) !== windowClass(to.window)) throw new Error('周期或模型范围不一致，不能合并。请保留为独立额度。');
  if (!from.scope.startsWith('manual:') && !to.scope.startsWith('manual:') && from.scope !== to.scope) throw new Error('功能范围不同，不能合并。');
  state.aliases ||= {};
  state.aliases[from.poolId] = to.poolId;
  state.observations = applyAliases(state.observations, state);
}
