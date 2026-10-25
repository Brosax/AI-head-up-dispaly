import path from 'node:path';
import {root,build,run} from './desktop-tools.mjs';

for(const [name,sources] of [
  ['QuotaSummary.Tests',['QuotaSummary.Tests.cs','QuotaSummary.cs']],
  ['QuotaPill.Tests',['QuotaPill.Tests.cs','QuotaSummary.cs','TrayPopup.cs']],
]){
  const executable=path.join(root,'artifacts','tests',`${name}.exe`);
  build(executable,sources);
  run(executable,[]);
}
