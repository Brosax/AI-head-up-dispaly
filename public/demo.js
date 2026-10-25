// Entirely separate from server state: these observations never leave the browser.
export function demoDashboard(providers) {
  const now = Date.now();
  const make = (provider, scope, scopeLabel, window, remaining, hours, channels) => {
    const id = `demo-${provider}-${window}`;
    const observedAt = new Date(now - 120000).toISOString();
    const resetsAt = new Date(now + hours * 3600000).toISOString();
    return { id, poolId: id, provider, accountKey: `demo-${provider}`, accountLabel: '示例账户', identityVerified: true,
      scope, scopeLabel, window, remaining, resetsAt, observedAt, channels,
      rule: '示例共享关系，仅用于展示。', plan: '示例套餐', source: 'demo', sourceLabel: '演示数据', evidence: 'demo',
      status: 'fresh', sourceCount: 1,
      history: [6, 4, 2, 0].map((offset, i) => ({ remaining: Math.min(100, remaining + (3 - i) * 4), observedAt: new Date(now - offset * 3600000 - 120000).toISOString(), resetsAt, sourceLabel: '演示数据' })),
    };
  };
  const pools = [
    make('openai', 'codex', 'Codex / Work', 'Weekly', 82, 72, ['Codex CLI', 'Codex 桌面', 'Codex 云端']),
    make('anthropic', 'claude-subscription', 'Claude 订阅', 'Session (5hr)', 68, 2.25, ['Claude 网页版', 'Claude Code']),
    make('anthropic', 'claude-subscription', 'Claude 订阅', 'Weekly', 43, 51, ['Claude 网页版', 'Claude Code']),
    make('xai', 'grok', 'Grok 订阅', 'Weekly', 91, 18, ['Grok 网页版', 'Grok App']),
    make('google', 'gemini-apps', 'Gemini Apps', 'Session (5hr)', 34, 3.5, ['Gemini 网页版', 'Gemini App']),
    make('google', 'gemini-apps', 'Gemini Apps', 'Weekly', 76, 90, ['Gemini 网页版', 'Gemini App']),
  ];
  return { providers, pools, recommendations: [pools[1].poolId, pools[3].poolId], sync: { message: '示例模式，不会读取或修改真实账户。' }, stats: { subscriptions: 4, pools: 6, fresh: 6, connected: 4 } };
}
