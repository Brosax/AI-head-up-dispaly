/* DOM-only adapters. No cookies, storage, conversation text, or private APIs. */
(() => {
  const text = node => (node?.innerText ?? node?.textContent ?? '').trim();
  const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  const validPercent = n => Number.isFinite(n) && n >= 0 && n <= 100;
  function resetDate(label, now = new Date()) {
    if (!label) return null;
    const value = label.replace(/\u00a0/g, ' ');
    const clock = value.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (!clock) return null;
    let hour = Number(clock[1]);
    if (clock[3]) hour = hour % 12 + (/PM/i.test(clock[3]) ? 12 : 0);
    if (hour > 23 || +clock[2] > 59) return null;
    const date = new Date(now); date.setHours(hour, +clock[2], 0, 0);
    const chinese = value.match(/(\d{1,2})月\s*(\d{1,2})日/);
    const spanish = value.match(/(\d{1,2}) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre) de (\d{4})/i);
    const english = value.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:,?\s+(\d{4}))?/i);
    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const day = days.findIndex(d => new RegExp(`\\b${d}\\b`, 'i').test(value));
    if (chinese) { date.setMonth(+chinese[1] - 1, +chinese[2]); if (date < now) date.setFullYear(date.getFullYear() + 1); }
    else if (spanish) date.setFullYear(+spanish[3], 'enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre'.split(' ').indexOf(spanish[2].toLowerCase()), +spanish[1]);
    else if (english) { date.setFullYear(+(english[3] || date.getFullYear()), 'january february march april may june july august september october november december'.split(' ').indexOf(english[1].toLowerCase()), +english[2]); if (!english[3] && date < now) date.setFullYear(date.getFullYear() + 1); }
    else if (day >= 0) { date.setDate(date.getDate() + (day - date.getDay() + 7) % 7); if (date <= now) date.setDate(date.getDate() + 7); }
    else if (/^(?:Resets at|重置时间[：:]?)\s*\d/i.test(value.trim())) { if (date <= now) date.setDate(date.getDate() + 1); }
    else return null;
    // Fail closed for ambiguous or implausible date strings.
    const delta = date - now;
    return delta > 0 && delta <= 8 * 86400000 ? date.toISOString() : null;
  }
  function identity(doc, provider) {
    if (provider === 'google') {
      const labels = Array.from(doc.querySelectorAll('a[href*="accounts.google.com"]')).map(e => e.getAttribute('aria-label') || '').join(' ');
      const email = labels.match(emailPattern)?.[0];
      return email ? { kind: 'email', value: email.toLowerCase() } : null;
    }
    const dialog = doc.querySelector('[role="dialog"]');
    if (!dialog) return null;
    if (provider === 'anthropic') {
      const org = text(dialog).match(/Organization ID\s*([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})/i)?.[1];
      return org ? { kind: 'organization', value: org.toLowerCase() } : null;
    }
    const email = text(dialog).match(emailPattern)?.[0];
    return email ? { kind: 'email', value: email.toLowerCase() } : null;
  }
  function extract(doc, provider, now = new Date()) {
    const metrics = [];
    let plan = null;
    if (provider === 'anthropic') {
      for (const meter of doc.querySelectorAll('[role="dialog"] [role="meter"]')) {
        const label = text(doc.getElementById(meter.getAttribute('aria-labelledby')));
        const window = /^Current session\b/i.test(label) ? 'Session (5hr)' : /^This week\b/i.test(label) ? 'Weekly' : null;
        if (!window) continue; // Excludes product breakdown, credits, money and other meters.
        const raw = meter.getAttribute('aria-valuenow');
        const used = raw === null || raw === '' ? NaN : Number(raw);
        if (!validPercent(used)) continue;
        let block = meter, resetLabel = '';
        for (let i=0;i<5 && block;i++,block=block.parentElement) {
          // Never borrow a reset from the neighbouring quota window.
          if (block.querySelectorAll('[role="meter"]').length > 1) break;
          resetLabel = text(block).match(/Resets\b[^\n]*/i)?.[0].replace(/\d+(?:\.\d+)?%\s*used.*$/i,'').trim() || '';
          if (resetLabel) break;
        }
        metrics.push({window, used, resetLabel, resetsAt:resetDate(resetLabel,now)});
      }
      plan = text(doc.querySelector('[role="dialog"]')).match(/\bMax\s*\(\d+x\)|\bPro\b/)?.[0] || null;
    } else if (provider === 'google') {
      for (const [selector,window] of [['[data-testid="current-usage"]','Session (5hr)'],['[data-testid="weekly-usage"]','Weekly']]) {
        const block = doc.querySelector(selector); if (!block) continue;
        const lines = text(block).split('\n').map(s=>s.trim());
        const usedLine = lines.find(s=>/已使用\s*[\d.]+%|[\d.]+%\s*used/i.test(s));
        const match = usedLine?.match(/([\d.]+)%/); if (!match) continue;
        const used = +match[1]; if (!validPercent(used)) continue;
        const resetLabel = lines.find(s=>/^(重置时间|Resets)/i.test(s)) || '';
        metrics.push({window,used,resetLabel,resetsAt:resetDate(resetLabel,now)});
      }
      plan = 'Gemini Apps'; // Do not infer subscription tier from an upsell banner.
    } else if (provider === 'xai') {
      const heading = Array.from(doc.querySelectorAll('h3')).find(e=>/Límite semanal|Weekly.*limit|每周.*限额/i.test(text(e)));
      if (heading) {
        const block = heading.parentElement?.parentElement;
        const number = block?.querySelector('number-flow-react[aria-label]');
        const match = number?.getAttribute('aria-label')?.match(/^([\d.]+)%$/);
        if (match && validPercent(+match[1])) {
          const reset = Array.from(block.querySelectorAll('span')).find(e=>/^Se restablece|^Resets|^重置/.test(text(e)));
          const resetLabel = text(reset);
          metrics.push({window:'Weekly',used:+match[1],resetLabel,resetsAt:resetDate(resetLabel,now)});
        }
        plan = text(heading).replace(/Límite semanal|Weekly.*limit|每周.*限额/i,'').trim() || null;
      }
    }
    return { metrics, plan, observedAt: now.toISOString() };
  }
  globalThis.HeadroomParser = {extract,identity,resetDate};
})();
