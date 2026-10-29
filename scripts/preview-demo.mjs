import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {root,build,run} from './desktop-tools.mjs';

// Fictional values only. Never load data/state.json when producing repository images.
const now=Date.now(),iso=hours=>new Date(now+hours*3600000).toISOString();
const pool=(provider,window,remaining,hours)=>({provider,window,remaining,resetsAt:iso(hours),observedAt:iso(0),accountKey:`demo-${provider}`,accountLabel:'Demo account',status:'fresh'});
const demo={providers:[],pools:[
  pool('openai','Weekly',78,144),pool('anthropic','Session (5hr)',64,3),pool('anthropic','Weekly',41,120),
  pool('xai','Weekly',32,48),pool('google','Session (5hr)',100,4),pool('google','Weekly',82,72),
],api:{openai:{enabled:true,remaining:'42.80',freshness:'fresh'},deepseek:{freshness:'fresh',isAvailable:true,balances:[{currency:'CNY',total:'18.60'},{currency:'USD',total:'4.20'}]},
  claude:{enabled:true,accounts:[{freshness:'fresh',purchased:'0.00',promotional:[{remaining:'75.25',granted:'100.00',expiresOn:iso(336).slice(0,10),appliesTo:'API, Playground'}]}]}},desktop:{connected:true}};
const directory=path.join(root,'artifacts','demo');mkdirSync(directory,{recursive:true});
const fixture=path.join(directory,'dashboard.json');writeFileSync(fixture,JSON.stringify(demo));
const executable=path.join(directory,'TrayPopup.Preview.exe');
build(executable,['TrayPopup.Preview.cs','QuotaSummary.cs','TrayPopup.cs']);
const imageDirectory=path.join(root,'docs','images');mkdirSync(imageDirectory,{recursive:true});
run(executable,[fixture,path.join(imageDirectory,'ai-head-up-dispaly-dark.png'),'dark']);
console.log('Created docs/images/ai-head-up-dispaly-dark.png with fictional demo data.');
