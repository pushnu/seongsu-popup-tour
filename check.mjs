// node check.mjs — 데이터 무결성 자가 점검
import assert from 'node:assert/strict';
import { POPUPS } from './data.js';
assert.equal(POPUPS.length, 37); // 팝업 35 + 네이버 장소 2
for (const p of POPUPS) {
  for (const k of ['id', 'name', 'address', 'lat', 'lng', 'period', 'satHours', 'week', 'summary']) assert.ok(p[k], `${p.id} missing ${k}`);
  if (!p.link) assert.ok(p.period.split('~')[1].trim() >= '2026-11-07', `${p.id} ended before 11/7`);
  assert.ok(/^\d{2}:\d{2}–\d{2}:\d{2}$/.test(p.satHours), `${p.id} bad hours`);
  if (p.booking) assert.ok(['required', 'info', 'check'].includes(p.booking.status), `${p.id} bad booking`);
}
assert.equal(new Set(POPUPS.map((p) => p.id)).size, 37);
assert.equal(new Set(POPUPS.map((p) => p.lat + ',' + p.lng)).size, 34, 'expected 34 distinct points');
assert.equal(POPUPS.filter((p) => p.booking).length, 8);
console.log('ok');
