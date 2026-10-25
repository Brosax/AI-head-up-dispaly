const zone='Europe/Madrid';
const day=value=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(value);
export function resetText(pool,now=Date.now()){
  const reset=Date.parse(pool.resetsAt);
  if(!Number.isFinite(reset))return '重置时间待确认';
  const minutes=Math.ceil((reset-now)/60000);
  if(minutes<=0)return '已到重置时间 · 待更新';
  if(pool.window==='Weekly')return minutes>=1440?`还有 ${Math.floor(minutes/1440)} 天重置`:minutes>=60?`还有 ${Math.floor(minutes/60)} 小时重置`:`还有 ${minutes} 分钟重置`;
  const today=day(now),then=day(reset);
  // Calendar comparison, not now+24h: DST transition days may be 23 or 25 hours.
  const tomorrow=new Date(today+'T12:00:00Z');tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
  const prefix=then===today?'今天':then===day(tomorrow)?'明天':new Intl.DateTimeFormat('zh-CN',{timeZone:zone,month:'numeric',day:'numeric'}).format(reset);
  return `${prefix} ${new Intl.DateTimeFormat('zh-CN',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(reset)} 重置`;
}
