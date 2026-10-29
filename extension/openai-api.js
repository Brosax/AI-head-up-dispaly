/* Read only the visible Credit remaining card on the OpenAI Platform home. */
(() => {
  const text = node => (node?.innerText ?? node?.textContent ?? '').replace(/\s+/g,' ').trim();
  const visible = node => !node.closest('[hidden],[aria-hidden="true"]');
  const money = value => {
    const match=value.match(/^(-?)(?:US)?\$\s*(-?)((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})$/);
    if(!match || match[1]&&match[2])return null;
    return (match[1]||match[2])+match[3].replaceAll(',','');
  };
  function extract(doc,now=new Date()) {
    const values=new Set();
    for(const link of doc.querySelectorAll('a[data-credit-purchase-location="home-credit-balance"][href="/settings/organization/billing/overview"]')) {
      if(!visible(link))continue;
      // The observed home card has a label, a money value and its billing link.
      // Keep the search local so spend, budgets and model prices cannot qualify.
      let block=link.parentElement;
      for(let depth=0;block&&depth<3;depth++,block=block.parentElement) {
        const children=Array.from(block.children).filter(visible);
        if(!children.some(node=>/^(?:Credit remaining|剩余额度|剩余余额|Crédito restante)$/i.test(text(node))))continue;
        const amounts=children.map(node=>money(text(node))).filter(value=>value!==null);
        if(amounts.length===1)values.add(amounts[0]);
        else return null;
        break;
      }
    }
    return values.size===1?{currency:'USD',remaining:[...values][0],observedAt:now.toISOString()}:null;
  }
  globalThis.HeadroomOpenaiApi={extract};
})();
