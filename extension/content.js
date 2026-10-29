// Register before DOM loading, including SPA landing routes. Read only after an
// explicit probe and a settings/usage/billing route check below succeeds.
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || message.type !== 'headroom-probe') return;
  try {
  if(location.hostname==='platform.openai.com') {
    if(message.stage==='usage' && /^\/home\/?$/.test(location.pathname)) {
      const balance=HeadroomOpenaiApi.extract(document);
      reply({balance,identity:{kind:'platform-view',value:'current'},observedAt:balance?.observedAt});
    } else reply({error:'wrong-page'});
    return;
  }
  if(location.hostname==='platform.claude.com') {
    if(message.stage==='usage' && location.pathname==='/settings/billing') {
      const balance=HeadroomClaudeApi.extract(document);
      // This is the current billing-page snapshot, not a verified account identity.
      // Do not make a visible balance depend on the responsive account menu.
      reply({balance,identity:{kind:'console-view',value:'current'},observedAt:balance?.observedAt});
    } else reply({error:'wrong-page'});
    return;
  }
  const provider = {'claude.ai':'anthropic','grok.com':'xai','gemini.google.com':'google'}[location.hostname];
  const route = location.pathname + location.search + location.hash;
  const isAccount = provider==='anthropic' ? /(?:\/settings\/account|#settings\/account)$/.test(route) : provider==='xai' && location.pathname==='/' && new URLSearchParams(location.search).get('_s')==='home';
  const isUsage = provider==='anthropic' ? /(?:\/settings\/usage|#settings\/usage)$/.test(route) : provider==='xai' ? location.pathname==='/' && new URLSearchParams(location.search).get('_s')==='usage' : provider==='google' && location.pathname==='/usage';
  if (message.stage==='identity' && isAccount) reply({identity:HeadroomParser.identity(document,provider)});
  else if (message.stage==='usage' && isUsage) reply({...HeadroomParser.extract(document,provider),identity:provider==='google'?HeadroomParser.identity(document,provider):null});
  else reply({error:'wrong-page'});
  } catch { reply({error:'parser-failed'}); }
});
