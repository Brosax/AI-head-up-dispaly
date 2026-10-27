import {spawn} from 'node:child_process';
import path from 'node:path';

export const validCollectorId=id=>typeof id==='string'&&/^[a-f0-9]{32}$/.test(id);
export function desktopCommand(root,args,timeout=12000){
  return new Promise((resolve,reject)=>{
    const child=spawn(path.join(root,'AI-head-up-dispaly.exe'),args,{cwd:root,windowsHide:true,stdio:'ignore'});
    const timer=setTimeout(()=>{child.kill();reject(Error('后台浏览器准备超时。'));},timeout);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('无法隐藏采集窗口，本次网页刷新已停止。'));});
  });
}
