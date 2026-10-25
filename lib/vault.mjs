import {spawn} from 'node:child_process';
import {readFile,writeFile,rename,access} from 'node:fs/promises';
import path from 'node:path';
export function protectSecret(root,mode,input){
  if(process.platform!=='win32')throw new Error('此版本的本地密钥保护需要 Windows；也可设置 DEEPSEEK_API_KEY 环境变量。');
  return new Promise((resolve,reject)=>{
    const child=spawn(path.join(root,'desktop','CredentialVault.exe'),[mode],{stdio:['pipe','pipe','ignore'],windowsHide:true});
    let result='';const timer=setTimeout(()=>{child.kill();reject(new Error('Windows 密钥保护超时。'));},10000);
    child.stdout.on('data',chunk=>{result+=chunk.toString();});
    child.stdin.on('error',()=>{});
    child.on('error',()=>{clearTimeout(timer);reject(new Error('无法启动 Windows 密钥保护组件。'));});
    child.on('close',code=>{clearTimeout(timer);if(code!==0)reject(new Error('无法解锁本地密钥，请在当前 Windows 账户下重新配置。'));else resolve(result);});
    child.stdin.end(input);
  });
}
const keyPath=directory=>path.join(directory,'deepseek-key.dpapi');
export async function hasDeepseekKey(directory){if(process.env.DEEPSEEK_API_KEY)return true;try{await access(keyPath(directory));return true;}catch{return false;}}
export async function saveDeepseekKey(root,directory,key){
  const encrypted=await protectSecret(root,'protect',key);const file=keyPath(directory);
  await writeFile(file+'.tmp',encrypted,{mode:0o600});await rename(file+'.tmp',file);
}
export async function readDeepseekKey(root,directory){
  if(process.env.DEEPSEEK_API_KEY)return process.env.DEEPSEEK_API_KEY.trim();
  let encrypted;try{encrypted=await readFile(keyPath(directory),'utf8');}catch(error){if(error.code==='ENOENT')return null;throw new Error('无法读取本地密钥配置。');}
  return protectSecret(root,'unprotect',encrypted);
}
