import test from 'node:test';
import assert from 'node:assert/strict';
import {browserFailures} from '../lib/refresh-errors.mjs';
test('failed Claude subscription is named without blaming successful Claude API or previous jobs',()=>{
  const state={browser:{anthropic:{status:'error',attemptedAt:'2026-10-27T10:00:00Z',error:'账户标识未读到'},'claude-api':{status:'ok',attemptedAt:'2026-10-27T10:00:01Z'},xai:{status:'error',attemptedAt:'2026-10-26T10:00:00Z',error:'旧失败'}}};
  assert.deepEqual(browserFailures(state,'2026-10-27T09:59:00Z'),['Claude 订阅：账户标识未读到']);
});
