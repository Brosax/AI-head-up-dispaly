import path from 'node:path';
import {root,build} from './desktop-tools.mjs';

const index=process.argv.indexOf('--out-dir');
if(index>=0&&!process.argv[index+1])throw Error('--out-dir requires a directory.');
const output=index>=0?path.resolve(root,process.argv[index+1]):root;
build(path.join(output,'Headroom.exe'),['Launcher.cs','QuotaSummary.cs','TrayPopup.cs'],{windowed:true,icon:true});
build(path.join(output,'desktop','CredentialVault.exe'),['CredentialVault.cs']);
console.log(`Desktop build complete: ${output}`);
