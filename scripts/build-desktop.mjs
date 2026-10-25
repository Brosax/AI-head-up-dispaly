import path from 'node:path';
import {copyFileSync} from 'node:fs';
import {root,build} from './desktop-tools.mjs';

const index=process.argv.indexOf('--out-dir');
if(index>=0&&!process.argv[index+1])throw Error('--out-dir requires a directory.');
const output=index>=0?path.resolve(root,process.argv[index+1]):root;
const executable=path.join(output,'AI-head-up-dispaly.exe');
build(executable,['Launcher.cs','QuotaSummary.cs','TrayPopup.cs'],{windowed:true,icon:true});
// Keep existing shortcuts and startup registrations working after the rename.
copyFileSync(executable,path.join(output,'Headroom.exe'));
build(path.join(output,'desktop','CredentialVault.exe'),['CredentialVault.cs']);
console.log(`Desktop build complete: ${output}`);
