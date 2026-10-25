import {WebSocketServer,WebSocket} from 'ws';
import {timingSafeEqual} from 'node:crypto';

export function createDesktopBridge(server,{token,port,onChange=()=>{}}) {
  const wss=new WebSocketServer({noServer:true,maxPayload:4096,perMessageDeflate:false});
  const clients=new Set(),pending=new Map();
  server.on('upgrade',(req,socket,head)=>{
    if(req.url!=='/api/desktop/bridge'||!['127.0.0.1:'+port,'localhost:'+port].includes(req.headers.host)||!/^chrome-extension:\/\/[a-p]{32}$/.test(req.headers.origin||'')||wss.clients.size>=4){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws));
  });
  wss.on('connection',ws=>{
    const authTimer=setTimeout(()=>ws.close(1008),5000);authTimer.unref();
    ws.on('error',()=>{});
    ws.on('message',raw=>{
      let message;try{message=JSON.parse(raw.toString());}catch{ws.close(1008);return;}
      if(!clients.has(ws)) {
        const supplied=message?.token;
        if(message?.type!=='authenticate'||typeof supplied!=='string'||!/^[a-f0-9]{64}$/.test(supplied)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(token))){ws.close(1008);return;}
        clearTimeout(authTimer);clients.add(ws);ws.send(JSON.stringify({type:'ready'}));onChange();return;
      }
      if(message?.type==='ping'){ws.send(JSON.stringify({type:'pong'}));return;}
      const task=pending.get(message?.jobId);
      if(message?.type==='complete'&&task?.ws===ws){clearTimeout(task.timer);pending.delete(message.jobId);task.resolve(message.error?{error:'部分网页读取失败，请检查登录状态。'}:{ok:true});}
    });
    ws.on('close',()=>{
      clearTimeout(authTimer);clients.delete(ws);
      for(const [id,task] of pending)if(task.ws===ws){clearTimeout(task.timer);pending.delete(id);task.reject(Error('浏览器连接已断开，请重试。'));}
      onChange();
    });
  });
  return {
    get connected(){return [...clients].some(ws=>ws.readyState===WebSocket.OPEN);},
    refresh(jobId,timeout=150000){
      const ws=[...clients].find(ws=>ws.readyState===WebSocket.OPEN);
      if(!ws)return Promise.reject(Error('请打开 Edge 并重新加载 Headroom 扩展。'));
      if(pending.size)return Promise.reject(Error('已有网页后台采集正在运行。'));
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{pending.delete(jobId);reject(Error('网页采集超时，请检查扩展。'));},timeout);timer.unref();
        pending.set(jobId,{ws,resolve,reject,timer});
        ws.send(JSON.stringify({type:'refresh',jobId}));
      });
    },
    close(){for(const ws of wss.clients)ws.terminate();wss.close();},
  };
}
