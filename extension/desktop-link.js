// Only a paired, local socket can request a refresh. Heartbeats never collect quotas.
let desktopSocket=null,desktopRetry=null,desktopHeartbeat=null,desktopConnecting=false;
function disconnectDesktop() {
  clearTimeout(desktopRetry);clearInterval(desktopHeartbeat);
  if(desktopSocket){const old=desktopSocket;desktopSocket=null;old.onclose=null;old.close();}
}
async function connectDesktop() {
  if(desktopSocket||desktopConnecting)return;
  desktopConnecting=true;
  try {
    const {token,enabled}=await chrome.storage.local.get(['token','enabled']);
    if(!enabled||!token)return;
    const socket=new WebSocket('ws://127.0.0.1:4317/api/desktop/bridge');desktopSocket=socket;
    socket.onopen=()=>{
      socket.send(JSON.stringify({type:'authenticate',token}));
      desktopHeartbeat=setInterval(()=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'ping'}));},20000);
    };
    socket.onmessage=async event=>{
      let message;try{message=JSON.parse(event.data);}catch{return;}
      if(message.type!=='refresh'||typeof message.jobId!=='string'||message.jobId.length>80)return;
      let result;try{result=await cycle();}catch{result={error:'后台采集失败'};}
      if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'complete',jobId:message.jobId,error:result.error||null}));
    };
    socket.onerror=()=>{};
    socket.onclose=()=>{
      clearInterval(desktopHeartbeat);if(desktopSocket===socket)desktopSocket=null;
      desktopRetry=setTimeout(()=>connectDesktop(),5000);
    };
  }finally{desktopConnecting=false;}
}
