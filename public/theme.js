(() => {
  const valid = mode => ['light','dark','system'].includes(mode);
  const system = matchMedia('(prefers-color-scheme: dark)');
  let mode = 'system', saving = false;
  try { const cached=localStorage.getItem('headroom-theme');if(valid(cached))mode=cached; } catch {}
  function apply(next) {
    if(valid(next))mode=next;
    const resolved=mode==='system'?(system.matches?'dark':'light'):mode;
    document.documentElement.dataset.theme=resolved;
    document.documentElement.dataset.themeMode=mode;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',resolved==='dark'?'#0d0f10':'#f3f2ed');
    document.querySelectorAll('[data-theme-select]').forEach(select=>{select.value=mode;});
    try { localStorage.setItem('headroom-theme',mode); } catch {}
  }
  apply(mode);
  system.addEventListener('change',()=>apply(mode));
  document.addEventListener('headroom:preferences',event=>{if(!saving)apply(event.detail?.theme);});
  document.addEventListener('DOMContentLoaded',()=>{
    apply(mode);
    document.querySelectorAll('[data-theme-select]').forEach(select=>select.addEventListener('change',async()=>{
      const before=mode,next=select.value;if(!valid(next))return;
      saving=true;select.disabled=true;apply(next);
      try {
        const response=await fetch('/api/preferences',{method:'POST',headers:{'Content-Type':'application/json','X-Headroom-Client':'local'},body:JSON.stringify({theme:next})});
        if(!response.ok)throw Error('保存失败');
        apply((await response.json()).preferences.theme);select.title='外观已保存';
      } catch { apply(before);select.title='外观保存失败，请重试'; }
      finally {saving=false;select.disabled=false;}
    }));
    fetch('/api/dashboard').then(r=>r.json()).then(value=>{if(!saving)apply(value.preferences?.theme);}).catch(()=>{});
  });
})();
