// POST bodies become history entries; the stream sees each entry once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHistory, submission } from '../src/history.ts';

const accept = () => ({ ok: true, diagnostics: [] });
const at = () => new Date('2026-11-11T00:00:00Z');

test('a submission defaults to RX markup', () => {
  assert.deepEqual(submission('<p>hi</p>', new URLSearchParams()), { code: '<p>hi</p>', syntax: 'rx' });
});

test('?type= makes a value eval and ?syntax=tsx selects TSX', () => {
  assert.deepEqual(submission('count()', new URLSearchParams('syntax=tsx&type=number')), { code: 'count()', syntax: 'tsx', type: 'number' });
});

test('an empty body or an unknown option is a 400, not an entry', () => {
  assert.ok('error' in submission('  ', new URLSearchParams()));
  assert.ok('error' in submission('x', new URLSearchParams('syntax=yield')));
  assert.ok('error' in submission('x', new URLSearchParams('type=object')));
});

test('entries are numbered in posting order and carry the check result', () => {
  const h = createHistory(s => s.code === 'bad' ? { ok: false, diagnostics: [{ code: 'PARSE', message: 'no' }] } : accept(), at);
  h.add({ code: 'good', syntax: 'rx' });
  h.add({ code: 'bad', syntax: 'rx' });
  assert.deepEqual(h.list().map(e => [e.id, e.ok]), [[1, true], [2, false]]);
});

test('a subscriber gets each new entry until it unsubscribes', () => {
  const h = createHistory(accept, at), seen: number[] = [];
  const off = h.subscribe(e => seen.push(e.id));
  h.add({ code: 'a', syntax: 'rx' });
  off();
  h.add({ code: 'b', syntax: 'rx' });
  assert.deepEqual(seen, [1]);
});
