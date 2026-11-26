import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2, tokenizeCountedProfileSource} from '../src/program-v2.mjs';

test('four suspension spellings map to the same effect and exact source position', () => {
  for (const spelling of ['suspends','susp','⧖','∂']) {
    const [effect, fnc] = tokenizeCountedProfileSource(spelling+' fnc');
    assert.equal(effect.value,'suspends');
    assert.equal(effect.lexeme ?? effect.value,spelling);
    assert.equal(effect.col,1);
    assert.equal(fnc.col,spelling.length+2);
    assert.equal(fnc.value,'fnc');
  }
  const tokens=tokenizeCountedProfileSource('suspension susp2 "⧖ ∂ susp" // ⧖ ∂');
  assert.equal(tokens[0].value,'suspension');
  assert.equal(tokens[1].value,'susp2');
  assert.equal(tokens[2].literal,'⧖ ∂ susp');
});

test('unlowered effects cannot emit synchronous JS or become ordinary names', () => {
  for (const spelling of ['suspends','susp','⧖','∂']) {
    assert.throws(()=>compileProgramV2('pub '+spelling+' fnc main(): int { return 42; }'),/E_SUSPENDS_UNSUPPORTED/);
    assert.throws(()=>compileProgramV2('pub '+spelling+' gen* values(): AsyncIterator<int> { yield 1; }'),/continuation/);
    assert.throws(()=>compileProgramV2('pub fnc '+spelling+'(): int { return 42; }'),/identifier expected/);
  }
  assert.equal(compileProgramV2('pub fnc main(): int { return 42; } // ⧖ ∂ susp'),
    compileProgramV2('pub fnc main(): int { return 42; }'));
});
