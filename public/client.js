export async function request(route,body){
  const response=await fetch(route,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Headroom-Client':'local'},body:JSON.stringify(body)});
  const value=await response.json();if(!response.ok)throw new Error(value.error||'请求失败');return value;
}
export function refreshBrowser(){
  return new Promise((resolve,reject)=>{
    const requestId=crypto.randomUUID();let completionTimer;
    const cleanup=()=>{clearTimeout(ackTimer);clearTimeout(completionTimer);document.removeEventListener('headroom:result',receive);};
    const receive=event=>{
      if(event.detail?.requestId!==requestId)return;
      if(event.detail.stage==='accepted'){clearTimeout(ackTimer);completionTimer||=setTimeout(()=>{cleanup();reject(new Error('网页采集超时，请查看扩展状态。'));},150000);}
      if(event.detail.stage==='complete'){cleanup();resolve(event.detail);}
    };
    const ackTimer=setTimeout(()=>{cleanup();reject(new Error('未连接新版扩展，请重新加载扩展并刷新窗口。'));},1500);
    document.addEventListener('headroom:result',receive);
    document.dispatchEvent(new CustomEvent('headroom:refresh',{detail:{requestId}}));
  });
}
export function subscribeDashboard(receive){
  const stream=new EventSource('/api/events');
  stream.onmessage=event=>{try{const value=JSON.parse(event.data);document.dispatchEvent(new CustomEvent('headroom:preferences',{detail:value.preferences}));receive(value);}catch{}};
  return ()=>stream.close();
}
