// The shipped samples check as their names say: the refused-* ones are refused, the rest are accepted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { check } from '../src/server.ts';
import { submission } from '../src/history.ts';
import { optionsOf } from '../scripts/post-samples.ts';

const dir = new URL('../samples/', import.meta.url);
for (const f of readdirSync(dir).sort()) {
  test(f + (f.includes('refused') ? ' is refused' : ' is accepted'), () => {
    const s = submission(readFileSync(new URL(f, dir), 'utf8'), optionsOf(f));
    assert.ok(!('error' in s));
    const r = check(s);
    assert.equal(r.ok, !f.includes('refused'), JSON.stringify(r.diagnostics));
  });
}

test('a refusal names its rule: an unsupported operator is PLAN, a write to a binding is READ_ONLY', () => {
  const codes = (f: string) => check(submission(readFileSync(new URL(f, dir), 'utf8'), optionsOf(f)) as never).diagnostics.map(d => d.code);
  assert.deepEqual(codes('07-refused-operator.rx'), ['PLAN']);
  assert.deepEqual(codes('08-refused-write.rx'), ['READ_ONLY']);
});
