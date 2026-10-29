const names={anthropic:'Claude 订阅','claude-api':'Claude API','openai-api':'OpenAI API',xai:'Grok',google:'Gemini'};
export function browserFailures(state,since='') {
  return Object.entries(names).flatMap(([id,name])=>{
    const result=state.browser?.[id];
    return result?.status==='error'&&result.attemptedAt>=since?[`${name}：${result.error||'读取失败，保留上次读数。'}`]:[];
  });
}
