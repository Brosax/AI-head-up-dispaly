// This bridge accepts only a refresh command from the local dashboard. No secrets cross the DOM.
if (location.origin==='http://127.0.0.1:4317' && ['/','/toolbar'].includes(location.pathname)) {
  document.addEventListener('headroom:refresh',event=>{
    const requestId=event.detail?.requestId;
    if(typeof requestId!=='string' || requestId.length>80) return;
    const respond=value=>document.dispatchEvent(new CustomEvent('headroom:result',{detail:{requestId,...value}}));
    respond({stage:'accepted'});
    chrome.runtime.sendMessage({type:'refresh'}).then(result=>respond({stage:'complete',...result})).catch(()=>respond({stage:'complete',error:'扩展已更新，请刷新面板后重试。'}));
  });
}
