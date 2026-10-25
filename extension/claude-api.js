/* Read the visible account label and balance sections of the Billing page only. */
(() => {
  const text = node => (node?.innerText ?? node?.textContent ?? '').trim();
  const money = value => {
    const match = value.match(/^(?:US)?\$\s*((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})$/);
    return match ? match[1].replaceAll(',', '') : null;
  };
  const cents = value => BigInt(value.replace('.', ''));
  function identity(doc) {
    // The visible account/organization switcher is sufficient for this one browser source.
    const clean = value => value.replace(/[\uE000-\uF8FF]/g, '').trim();
    for (const menu of doc.querySelectorAll('nav button[aria-haspopup="menu"]')) {
      let lines = text(menu).split(/\n/).map(clean).filter(Boolean);
      if (lines.length < 2) lines = Array.from(menu.querySelectorAll('span,div')).filter(e=>!e.children.length).map(e=>clean(text(e))).filter(Boolean);
      if (lines.length >= 2) return {kind:'console-label',value:lines.join(' / '),label:lines.at(-1)};
    }
    return null;
  }
  function dateOnly(value) {
    const m = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    const date = new Date(Date.UTC(+m[3], +m[1]-1, +m[2]));
    return date.getUTCFullYear()===+m[3] && date.getUTCMonth()===+m[1]-1 && date.getUTCDate()===+m[2] ? date.toISOString().slice(0,10) : null;
  }
  function extract(doc, now = new Date()) {
    const headings = Array.from(doc.querySelectorAll('h2'));
    const credit = headings.find(e=>text(e)==='Credit balance')?.closest('section');
    if (!credit) return null;
    const creditText=text(credit);
    const amountPattern=/(?:US)?\$\s*((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})/;
    const amountText=text(credit.querySelector('[data-testid="credit-balance"]')?.firstElementChild) || creditText.split('\n').find(line=>/^(?:US)?\$[\d,.\s]+$/.test(line.trim())) || '';
    const purchasedMatch=amountText.match(amountPattern);
    if (!purchasedMatch) return null;
    const purchased=purchasedMatch[1].replaceAll(',','');
    const section=headings.find(e=>text(e)==='Promotional credits')?.closest('section');
    const promotional=[];
    for (const row of section?.querySelectorAll('tbody tr') || []) {
      const cells=Array.from(row.querySelectorAll('td')).map(text);
      const parts=cells[0]?.split(/\s*of\s*/);
      if(parts?.length!==2) return null;
      const remaining=money(parts[0]),granted=money(parts[1]);
      if(remaining===null || granted===null || cents(remaining)>cents(granted)) return null;
      promotional.push({remaining,granted,expiresOn:dateOnly(cells[2]||''),expiresLabel:cells[2]||'',appliesTo:cells[1]||'页面未注明'});
    }
    // Wait for the detail rows when the page explicitly says promotional credit exists.
    if (/promotional credit available/.test(creditText) && !promotional.length) return null;
    return {currency:'USD',purchased,promotional,observedAt:now.toISOString()};
  }
  globalThis.HeadroomClaudeApi = {identity,extract};
})();
