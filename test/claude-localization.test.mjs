import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import '../extension/parser.js';

const {identity,extract}=globalThis.HeadroomParser;
const now=new Date('2026-10-29T10:00:00Z');
const organization='12345678-1234-1234-1234-123456789012';
const documentOf=html=>parseHTML(`<html><body>${html}</body></html>`).document;
const read=html=>extract(documentOf(html),'anthropic',now).metrics.map(({window,used})=>({window,used}));
let nextId=0;
function meter(label,used,{attribute='aria-labelledby',suffix='',hidden=false}={}) {
  const id=`quota-${++nextId}`;
  const accessibility=attribute==='aria-label'?`aria-label="${label}"`:`aria-labelledby="${id}${suffix?` ${id}-detail`:''}"`;
  return `<section${hidden?' hidden':''}><span id="${id}">${label}</span>${suffix?`<span id="${id}-detail">${suffix}</span>`:''}<div role="meter" ${accessibility} aria-valuenow="${used}"></div><span>${used}% used</span></section>`;
}

for(const label of ['Copiar ID de organización','复制组织 ID','Copy Organization ID','copy organization id']) {
  test(`Claude organization identity reads explicit localized copy control: ${label}`,()=>{
    const doc=documentOf(`<main><button aria-label="${label}"><span>${organization}</span><span>\uE000</span></button></main>`);
    assert.deepEqual(identity(doc,'anthropic'),{kind:'organization',value:organization});
  });
}

test('Claude identity never borrows an unrelated UUID outside the explicitly labelled control',()=>{
  for(const html of [
    `<main><p>${organization}</p></main>`,
    `<main><button aria-label="Copy organization ID"><span>copy</span></button><p>${organization}</p></main>`,
    `<main><button aria-label="Copy conversation ID">${organization}</button></main>`,
    `<main><button aria-label="复制组织 ID">not-a-uuid</button><p>${organization}</p></main>`,
  ])assert.equal(identity(documentOf(html),'anthropic'),null);
});

for(const [locale,session,week] of [['es','Sesión actual','Esta semana'],['zh','当前会话','本周'],['en','Current session','This week']]) {
  for(const container of ['<main>','<div role="dialog">']) {
    test(`Claude ${locale} session and week meters work in ${container}`,()=>{
      const close=container==='<main>'?'</main>':'</div>';
      assert.deepEqual(read(`${container}${meter(session,23)}${meter(week,7)}${close}`),[
        {window:'Session (5hr)',used:23},{window:'Weekly',used:7},
      ]);
    });
  }
}

test('Claude meter labels resolve all IDs in aria-labelledby',()=>{
  assert.deepEqual(read(`<div role="dialog">${meter('Current session',34,{suffix:'All models'})}</div>`),[{window:'Session (5hr)',used:34}]);
});

test('Claude meter reads a direct aria-label when aria-labelledby is absent',()=>{
  assert.deepEqual(read(`<main>${meter('Sesión actual',45,{attribute:'aria-label'})}${meter('本周',12,{attribute:'aria-label'})}</main>`),[
    {window:'Session (5hr)',used:45},{window:'Weekly',used:12},
  ]);
});

test('Claude model-specific weekly meters never become the shared subscription weekly limit',()=>{
  const excluded=['Claude Code','This week (Sonnet only)','Esta semana (solo Sonnet)','本周（仅 Sonnet）','Weekly Claude Code'];
  assert.deepEqual(read(`<div role="dialog">${meter('This week',9)}${excluded.map(label=>meter(label,87)).join('')}</div>`),[{window:'Weekly',used:9}]);
  assert.deepEqual(read(`<main>${excluded.map(label=>meter(label,87)).join('')}</main>`),[]);
});

test('Claude identical hidden duplicate meters produce only one observation for each window',()=>{
  assert.deepEqual(read(`<div role="dialog">${meter('Current session',20)}${meter('Current session',20,{hidden:true})}${meter('This week',5)}${meter('This week',5,{hidden:true})}</div>`),[
    {window:'Session (5hr)',used:20},{window:'Weekly',used:5},
  ]);
});

test('Claude conflicting readings for the same window fail closed without discarding an independent window',()=>{
  assert.deepEqual(read(`<div role="dialog">${meter('Current session',20)}${meter('Current session',40)}${meter('This week',5)}</div>`),[{window:'Weekly',used:5}]);
});
