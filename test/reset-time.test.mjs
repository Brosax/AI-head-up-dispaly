import test from 'node:test';
import assert from 'node:assert/strict';
import {resetText} from '../public/reset-time.js';
test('weekly countdown and unknown/expired resets never invent a new allowance',()=>{
  const now=Date.parse('2026-10-25T10:00:00Z');
  assert.equal(resetText({window:'Weekly',resetsAt:'2026-10-28T11:00:00Z'},now),'还有 3 天重置');
  assert.equal(resetText({window:'Weekly',resetsAt:null},now),'重置时间待确认');
  assert.equal(resetText({window:'Session (5hr)',resetsAt:'2026-10-25T09:00:00Z'},now),'已到重置时间 · 待更新');
});
test('five-hour windows use Madrid clock time and calendar day across DST',()=>{
  assert.equal(resetText({window:'Session (5hr)',resetsAt:'2026-10-25T17:30:00Z'},Date.parse('2026-10-25T14:00:00Z')),'今天 18:30 重置');
  assert.equal(resetText({window:'Session (5hr)',resetsAt:'2026-10-26T00:30:00Z'},Date.parse('2026-10-25T22:00:00Z')),'明天 01:30 重置');
  assert.equal(resetText({window:'Session (5hr)',resetsAt:'2026-10-25T00:30:00Z'},Date.parse('2026-10-24T21:00:00Z')),'明天 02:30 重置');
});
