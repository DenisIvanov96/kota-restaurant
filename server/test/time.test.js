import test from 'node:test';
import assert from 'node:assert/strict';
import { sofiaLocalToUtc, utcToSofiaLocal, sofiaDate, isValidDate, addDays } from '../src/time.js';

test('sofia local <-> utc, summer and winter', () => {
  assert.equal(sofiaLocalToUtc('2026-06-15T13:00'), Date.parse('2026-06-15T10:00:00Z'));
  assert.equal(sofiaLocalToUtc('2026-01-15T13:00'), Date.parse('2026-01-15T11:00:00Z'));
  assert.equal(utcToSofiaLocal(Date.parse('2026-06-14T21:00:00Z')), '2026-06-15T00:00');
});

test('spring-forward gap moves forward one hour', () => {
  const ms = sofiaLocalToUtc('2026-03-29T03:30');
  assert.equal(utcToSofiaLocal(ms), '2026-03-29T04:30');
});

test('autumn overlap picks the first occurrence', () => {
  const ms = sofiaLocalToUtc('2026-10-25T03:30');
  assert.equal(ms, Date.parse('2026-10-25T00:30:00Z'));
  assert.equal(utcToSofiaLocal(ms), '2026-10-25T03:30');
});

test('rejects malformed and impossible values', () => {
  for (const s of ['2026-02-30T10:00', '2026-13-01T10:00', '2026-06-15 10:00', '2026-06-15T24:00', '2026-06-15', '', null]) {
    assert.equal(sofiaLocalToUtc(s), null, String(s));
  }
  assert.ok(isValidDate('2028-02-29'));
  assert.ok(!isValidDate('2027-02-29'));
});

test('date helpers', () => {
  assert.equal(sofiaDate(Date.parse('2026-06-14T20:59:59Z')), '2026-06-14');
  assert.equal(sofiaDate(Date.parse('2026-06-14T21:00:00Z')), '2026-06-15');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});
