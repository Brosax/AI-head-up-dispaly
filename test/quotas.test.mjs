import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTokscale, mergeObservations, buildPools, createManualObservation, recommendations, readRemaining, applyAliases, linkQuotaPools, dashboard } from '../lib/quotas.mjs';

const NOW = '2026-10-24T20:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const RESET = '2026-10-24T22:00:00.000Z';
const metric = (label = 'Weekly', remaining = 68) => ({ label, used_percent: 100 - remaining, remaining_percent: remaining, resets_at: RESET });
const row = (id = 'account-a', provider = 'Claude', metrics = [metric()]) => ({ provider, account: { id }, metrics });
const normalize = (raw, source = 'tokscale', time = NOW) => normalizeTokscale(raw, time, source).observations;

test('web and code observations of one pool use the latest snapshot, never sum percentages', () => {
  const original = normalize([row()]);
  const web = createManualObservation({ provider: 'anthropic', targetPoolId: original[0].poolId, remaining: 63, resetsAt: RESET, confirmShared: true }, original, '2026-10-24T20:02:00.000Z');
  const pools = buildPools(mergeObservations(original, [web]), NOW_MS + 180000);
  assert.equal(pools.length, 1); assert.equal(pools[0].remaining, 63); assert.equal(pools[0].sourceCount, 2);
  assert.ok(pools[0].channels.includes('Claude Code')); assert.ok(pools[0].channels.includes('Claude 网页版'));
});
test('different accounts and overlapping session/weekly windows stay independent', () => {
  const observations = normalize([row('a', 'Claude', [metric('Weekly'), metric('Session (5hr)')]), row('b')]);
  assert.equal(buildPools(observations, NOW_MS).length, 3);
});
test('same email does not override two different authoritative account IDs', () => {
  const observations = normalize([{ ...row('a'), email: 'same@example.com' }, { ...row('b'), email: 'same@example.com' }]);
  assert.equal(buildPools(observations, NOW_MS).length, 2);
});
test('duplicate imports of the same data are idempotent when the account is identified', () => {
  const first = normalize([row()], 'tokscale-import');
  const second = normalize([row()], 'tokscale-import');
  assert.equal(mergeObservations(first, second).length, 1);
});
test('unknown identities never silently merge across sources or import batches', () => {
  const raw = [{ provider: 'Claude', metrics: [metric()] }];
  const a = normalize(raw), b = normalize(raw, 'tokscale-import');
  assert.notEqual(a[0].poolId, b[0].poolId);
  assert.equal(buildPools(mergeObservations(a, b), NOW_MS).length, 2);
  const replacement = normalize(raw);
  const merged = mergeObservations(a, replacement);
  assert.equal(merged.length, 1); assert.equal(merged[0].id, replacement[0].id);
});
test('null, invalid, and contradictory percentages stay unknown, not zero', () => {
  assert.equal(readRemaining({}), null); assert.equal(readRemaining({ used_percent: null }), null);
  assert.equal(readRemaining({ used_percent: '4' }), null); assert.equal(readRemaining({ remaining_percent: 120 }), null);
  assert.equal(readRemaining({ remaining_percent: 70, used_percent: 60 }), null);
  assert.equal(readRemaining({ used_percent: 0 }), 100); assert.equal(readRemaining({ remaining_percent: 0 }), 0);
});
test('reset passage does not automatically replenish the pool', () => {
  const pool = buildPools(normalize([row()]), Date.parse(RESET) + 1)[0];
  assert.equal(pool.status, 'expired'); assert.equal(pool.remaining, 68);
  assert.equal(recommendations([pool], Date.parse(RESET) + 1).length, 0);
});
test('old imports stay stale and are excluded from recommendations', () => {
  const pools = buildPools(normalize([row()]), NOW_MS + 16 * 60000);
  assert.equal(pools[0].status, 'stale'); assert.equal(recommendations(pools, NOW_MS + 16 * 60000).length, 0);
});
test('low weekly allowance suppresses an otherwise expiring session recommendation', () => {
  const pools = buildPools(normalize([row('a', 'Claude', [metric('Session (5hr)', 75), metric('Weekly', 3)])]), NOW_MS);
  assert.equal(recommendations(pools, NOW_MS).length, 0);
});
test('manual links require explicit confirmation and reject cross-provider targets', () => {
  const existing = normalize([row()]);
  assert.throws(() => createManualObservation({ provider: 'anthropic', targetPoolId: existing[0].poolId, remaining: 50 }, existing, NOW), /确认/);
  assert.throws(() => createManualObservation({ provider: 'google', targetPoolId: existing[0].poolId, remaining: 50, confirmShared: true }, existing, NOW), /其他平台/);
});
test('manual observations cannot be in the future, or reset before observation', () => {
  const input = { provider: 'google', accountLabel: 'personal', scopeLabel: 'Gemini Apps', window: 'Weekly', remaining: 60 };
  assert.throws(() => createManualObservation({ ...input, observedAt: RESET }, [], NOW), /未来/);
  assert.throws(() => createManualObservation({ ...input, resetsAt: '2026-10-23T20:00:00Z' }, [], NOW), /重置时间/);
});
test('token reports and unsupported Gemini CLI sources cannot masquerade as quotas', () => {
  assert.throws(() => normalizeTokscale({ tokens: 10000 }), /数组/);
  assert.equal(normalize([{ provider: 'Gemini CLI', tokens: 50000, metrics: [metric()] }]).length, 0);
});
test('different sources with simultaneous contradictory snapshots show conflict', () => {
  const a = normalize([row()], 'tokscale'), b = normalize([row('account-a', 'Claude', [metric('Weekly', 12)])], 'tokscale-import');
  assert.equal(buildPools([...a, ...b], NOW_MS)[0].status, 'conflict');
});
test('explicit identity aliases combine records and route future identified snapshots', () => {
  const originals = normalize([row('a'), row('b')]);
  const state = { observations: originals };
  linkQuotaPools(state, { fromPoolId: originals[0].poolId, toPoolId: originals[1].poolId, confirm: true });
  assert.equal(buildPools(state.observations, NOW_MS).length, 1);
  const incoming = normalize([row('a', 'Claude', [metric('Weekly', 51)])], 'tokscale', '2026-10-24T20:03:00Z');
  state.observations = mergeObservations(state.observations, applyAliases(incoming, state));
  const pools = buildPools(state.observations, NOW_MS + 180000);
  assert.equal(pools.length, 1); assert.equal(pools[0].remaining, 51);
});
test('weekly, session and model-specific limits cannot be collapsed', () => {
  for (const other of ['Session (5hr)', 'Weekly Opus']) {
    const observations = normalize([row('a', 'Claude', [metric('Weekly'), metric(other)])]);
    assert.throws(() => linkQuotaPools({ observations }, { fromPoolId: observations[0].poolId, toPoolId: observations[1].poolId, confirm: true }), /周期或模型范围/);
  }
});
test('a failed or partial refresh marks earlier automatic observations stale immediately', () => {
  const observations = normalize([row()]);
  for (const sync of [{ attemptedAt: '2026-10-24T20:01:00Z', error: 'timeout' }, { completedAt: '2026-10-24T20:01:00Z', receivedPoolIds: [] }]) {
    assert.equal(dashboard({ observations, sync }, NOW_MS + 60000).pools[0].status, 'stale');
  }
});
