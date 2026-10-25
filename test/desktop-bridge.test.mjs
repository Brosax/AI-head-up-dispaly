import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {createDesktopBridge} from '../lib/desktop-bridge.mjs';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

test('desktop bridge authenticates paired extension, dispatches once, rejects forged results and disconnects safely',async()=>{
  const server=http.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');
  const port=server.address().port,token='a'.repeat(64),origin='chrome-extension://'+'a'.repeat(32);
  const bridge=createDesktopBridge(server,{token,port});const sockets=[];
  const connect=async originValue=>{const ws=new WebSocket(`ws://127.0.0.1:${port}/api/desktop/bridge`,{origin:originValue});sockets.push(ws);return ws;};
  try {
    const foreign=await connect('https://example.com');await once(foreign,'error');assert.equal(bridge.connected,false);
    const bad=await connect(origin);await once(bad,'open');bad.send(JSON.stringify({type:'authenticate',token:'b'.repeat(64)}));await once(bad,'close');assert.equal(bridge.connected,false);
    const good=await connect(origin);await once(good,'open');const ready=once(good,'message');good.send(JSON.stringify({type:'authenticate',token}));assert.equal(JSON.parse((await ready)[0]).type,'ready');assert.equal(bridge.connected,true);
    const command=once(good,'message');const result=bridge.refresh('job-1');assert.deepEqual(JSON.parse((await command)[0]),{type:'refresh',jobId:'job-1'});
    await assert.rejects(bridge.refresh('job-duplicate'),/正在运行/);
    good.send(JSON.stringify({type:'complete',jobId:'wrong'}));
    good.send(JSON.stringify({type:'complete',jobId:'job-1',error:null}));assert.deepEqual(await result,{ok:true});
    const pending=bridge.refresh('job-2');const closed=assert.rejects(pending,/断开/);good.close();await closed;
  }finally{for(const ws of sockets)ws.terminate();bridge.close();await new Promise(resolve=>server.close(resolve));}
});

test('extension desktop socket only collects for explicit commands, never heartbeats or reconnects',async()=>{
  const code=await readFile(new URL('../extension/desktop-link.js',import.meta.url),'utf8');
  const sent=[],sockets=[],intervals=[];let cycles=0;const storage={enabled:true,token:'a'.repeat(64)};
  class Socket {static OPEN=1;constructor(url){this.url=url;this.readyState=1;sockets.push(this);}send(message){sent.push(JSON.parse(message));}close(){}}
  const context=vm.createContext({chrome:{storage:{local:{get:async()=>storage}}},WebSocket:Socket,cycle:async()=>{cycles++;return{ok:true};},setInterval:fn=>{intervals.push(fn);return 1;},clearInterval:()=>{},setTimeout:()=>1,clearTimeout:()=>{}});
  vm.runInContext(code,context);await vm.runInContext('connectDesktop()',context);
  const ws=sockets[0];assert.equal(ws.url,'ws://127.0.0.1:4317/api/desktop/bridge');ws.onopen();intervals[0]();assert.equal(cycles,0);assert.equal(sent[0].type,'authenticate');
  await ws.onmessage({data:JSON.stringify({type:'pong'})});assert.equal(cycles,0);
  await ws.onmessage({data:JSON.stringify({type:'refresh',jobId:'fixture'})});assert.equal(cycles,1);assert.deepEqual(sent.at(-1),{type:'complete',jobId:'fixture',error:null});
  await vm.runInContext('connectDesktop()',context);assert.equal(sockets.length,1);
});
