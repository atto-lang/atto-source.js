import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2} from '../src/program-v2.mjs';

async function guest(source) {
  return import('data:text/javascript;charset=utf-8,' + encodeURIComponent(compileProgramV2(source)));
}

test('guard lists: all eight triples agree between both spellings and explicit conjunction', async () => {
  const m = await guest(`
    fnc pair(bool a, bool b): bool { return a && b; }
    pub fnc brace(bool a, bool b, bool c): int {
      guard pair(a, b), c, true { return 1; }
      return 42;
    }
    pub fnc keyword(bool a, bool b, bool c): int {
      guard a, b, c else return 1; end
      return 42;
    }
    pub fnc explicit(bool a, bool b, bool c): int {
      guard a && b && c { return 1; }
      return 42;
    }
  `);
  for (const a of [false,true]) for (const b of [false,true]) for (const c of [false,true]) {
    const want = a && b && c ? 42n : 1n;
    assert.equal(m.brace(a,b,c),want);
    assert.equal(m.keyword(a,b,c),want);
    assert.equal(m.explicit(a,b,c),want);
  }
});

test('guard lists skip a real trapping RHS after first false; positive control reaches trap', async () => {
  const m = await guest(`
    fnc checked(int divisor): bool { return 42 / divisor eq 42; }
    pub fnc brace(bool a, bool b, int divisor): int {
      guard a, b, checked(divisor) { return 1; }
      return 42;
    }
    pub fnc keyword(bool a, bool b, int divisor): int {
      guard a, b, checked(divisor) else return 1; end
      return 42;
    }
  `);
  for (const run of [m.brace,m.keyword]) {
    assert.equal(run(false,true,0n),1n);
    assert.equal(run(true,false,0n),1n);
    assert.equal(run(true,true,1n),42n);
    assert.throws(()=>run(true,true,0n));
  }
});

test('unreachable non-Boolean guard predicates still fail static checking', () => {
  for (const predicate of ['false, 42', 'true, false, 42', '42, false']) {
    for (const failure of ['{ return 1; }','else return 1; end']) {
      const source = 'pub fnc main(): int { guard '+predicate+' '+failure+' return 42; }';
      assert.throws(()=>compileProgramV2(source), /error: program IR: boolean expression required|error: program IR:/, source);
    }
  }
});

test('empty, trailing and doubled guard separators fail without ESM output', () => {
  for (const predicate of ['', 'true,', 'true,,false', ',true']) {
    const source = 'pub fnc main(): int { guard '+predicate+' { return 1; } return 42; }';
    assert.throws(()=>compileProgramV2(source), /error: program v2:/, source);
  }
});
