import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2} from '../src/program-v2-audited.mjs';

test('public routines remain direct-call-only at ESM boundary', () => {
  const rejected = [
    'pub routine main(): int {return 42;}',
    'pub /*comment*/ routine main(): int {return 42;}',
    'pub /* nesting /* nested */ done */ routine main(): int {return 42;}'
  ];
  for (const source of rejected) {
    assert.throws(()=>compileProgramV2(source),/direct-call-only/);
  }
});

test('root module ambiguity fails closed pending separate linker symbols', () => {
  assert.throws(
    ()=>compileProgramV2('define module root pub fnc f(): int {return 1;} end'),
    /module named root/
  );
});

test('comment text cannot masquerade as a public routine', () => {
  const generated=compileProgramV2('// pub routine ignored\npub fnc main(): int {return 42;}');
  assert.match(generated,/export/);
});

test('flat source namespaces remain metadata without an ESM export', () => {
  const generated=compileProgramV2('namespace payments; define module math pub fnc get(): int {return 42;} end');
  assert.match(generated,/Object.create\(null\)/);
  assert.doesNotMatch(generated,/as "payments"/);
});
