import test from 'node:test';
import assert from 'node:assert/strict';
import {formatMsMomentForSamara as date} from '../../web/office/ms-production-date.mjs';
test('MoySklad MSK moment rolls over correctly into Samara date at midnight',()=>{
  assert.equal(date('2026-11-19 23:53:00.000'),'20.11.2026 00:53');
  assert.equal(date('2026-11-20 00:28:00.000'),'20.11.2026 01:28');
});
test('date-only stays unchanged and malformed dates are rejected',()=>{
  assert.equal(date('2026-11-20'),'20.11.2026');
  assert.equal(date('abc'),'—');
  assert.equal(date('2026-13-01 00:00:00'),'—');
  assert.equal(date('2026-11-20 25:00:00'),'—');
});
