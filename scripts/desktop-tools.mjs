import {existsSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

export const root=fileURLToPath(new URL('..',import.meta.url));
export function compiler(){
  if(process.platform!=='win32')throw Error('The desktop app requires Windows.');
  const windowsRoot=process.env.SystemRoot||'C:\\Windows';
  const found=['Framework64','Framework'].map(folder=>path.join(windowsRoot,'Microsoft.NET',folder,'v4.0.30319','csc.exe')).find(existsSync);
  if(!found)throw Error('The .NET Framework C# compiler was not found.');
  return found;
}
export function run(executable,args){
  const result=spawnSync(executable,args,{cwd:root,stdio:'inherit',windowsHide:true});
  if(result.error)throw result.error;
  if(result.status!==0)throw Error(`${path.basename(executable)} failed (exit ${result.status}). Close Headroom before rebuilding.`);
}
export function build(output,sources,{windowed=false,icon=false}={}){
  mkdirSync(path.dirname(output),{recursive:true});
  run(compiler(),['/nologo',`/target:${windowed?'winexe':'exe'}`,`/out:${output}`,
    '/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.Web.Extensions.dll','/reference:System.Security.dll',
    ...(icon?[`/win32icon:${path.join(root,'desktop','headroom.ico')}`]:[]),...sources.map(file=>path.join(root,'desktop',file))]);
}
