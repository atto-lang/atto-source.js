import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileFreestandingCore} from '../src/freestanding-core.mjs';
import {compileToProgramIRV2} from '../src/program-v2.mjs';
import {PreludeProfile, PreludeScope, PRELUDE_BINDINGS, resolvePrelude,
  isProtectedPreludeIdentity, isCoreSumCarrier, isCoreConstructor}
  from '../src/automatic-prelude.mjs';

test('core prelude is immutable, canonical and allocator independent', () => {
  const names = new Set();
  for (const binding of PRELUDE_BINDINGS) {
    assert.ok(!names.has(binding.name), 'duplicate prelude name');
    names.add(binding.name);
    assert.equal(Object.isFrozen(binding), true);
    assert.ok(binding.canonical.endsWith('/' + binding.name));
    assert.ok(!binding.canonical.includes('..'));
  }
  for (const name of ['Option','Result','Some','None','Ok','Err','Array','Slice','Tuple','Error']) {
    assert.equal(resolvePrelude(name, PreludeProfile.CORE)?.scope, PreludeScope.CORE);
  }
  for (const name of ['String','List','Vec','Map','Set','Box']) {
    assert.equal(resolvePrelude(name, PreludeProfile.CORE), null);
    assert.equal(resolvePrelude(name, PreludeProfile.HOSTED)?.scope, PreludeScope.ALLOC);
  }
  for (const name of ['HashMap','HashSet','Entry','Object'])
    assert.equal(resolvePrelude(name, PreludeProfile.HOSTED), null);
  assert.throws(() => resolvePrelude('Option', 'invalid'), /invalid prelude/);
});

test('sum variants and loan-sensitive ownership identities cannot be forged', () => {
  for (const name of ['Some','None','Ok','Err']) {
    assert.equal(isCoreConstructor(name), true);
    assert.equal(isProtectedPreludeIdentity(name), true);
  }
  assert.equal(isCoreConstructor('Map'), false);
  assert.equal(isCoreSumCarrier('Option',1), true);
  assert.equal(isCoreSumCarrier('Option',2), false);
  assert.equal(isCoreSumCarrier('Result',2), true);
  assert.equal(isCoreSumCarrier('Result',1), false);
  assert.equal(isCoreSumCarrier('Object',1), false);
  assert.equal(resolvePrelude('Slice', PreludeProfile.CORE).ownership,'borrowed_view');
  assert.equal(resolvePrelude('Result', PreludeProfile.CORE).ownership,'payload');
  assert.equal(resolvePrelude('Box', PreludeProfile.ALLOC).ownership,'owned');
});

test('real freestanding compiler refuses compiler-owned alias spoofing', () => {
  const source='define module core as pub fnc Map(): int { return 42; } end';
  assert.throws(() => compileFreestandingCore(source), /E_PRELUDE_SPOOF/);
});

test('real compiled scalar core Option/Result modules remain admitted', () => {
  for (const name of ['option','result']) {
    const file=new URL('../core/'+name+'.atto', import.meta.url);
    const source=readFileSync(file,'utf8');
    const compiled=compileFreestandingCore(source);
    assert.ok(compiled.length>100);
    assert.doesNotMatch(compiled,/^\s*import\b/m);
  }
  // This test validates compilation only; existing suite separately executes
  // the actual generated guest ESM and checks the scalar tagged-value ABI.
});

test('unsupported affine borrow syntax must not compile as a host fallback', () => {
  assert.throws(() => compileFreestandingCore(
    'define module core as pub fnc escape(borrow Option<Box> v): Box { return v.unwrap(); } end'));
});

test('every program-v2 declaration path protects the implicit prelude', () => {
  for (const source of [
    'pub fnc Map(): int { return 42; }',
    'define class Map as end',
    'generator* Map(): Iterator<int> { yield 42; }',
    'define module Result as end'
  ]) {
    assert.throws(() => compileToProgramIRV2(source), /E_PRELUDE_SPOOF/,
      'expected protected-name rejection before guest output: '+source);
  }
});
