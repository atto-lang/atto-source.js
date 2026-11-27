import test from 'node:test';
import assert from 'node:assert/strict';
import {compile,compileToIR} from '../src/compiler.mjs';

test('scalar source rejects all suspension effects and reserved names consistently',()=>{
  for(const alias of ['suspends','susp','⧖','∂']){
    for(const source of [
      'pub '+alias+' fnc main(): int { return 42; }',
      'pub fnc '+alias+'(): int { return 42; }',
      'pub fnc main(int '+alias+'): int { return 42; }',
      'pub fnc main(): int { return '+alias+'(); }'
    ]){
      for(const compiler of [compile,compileToIR])
        assert.throws(()=>compiler(source),/E_SUSPENDS_UNSUPPORTED/,source);
    }
  }
});

test('scalar comments and longer identifiers remain ordinary source',async()=>{
  const source='pub fnc main(int suspension,int susp2): int { return suspension+susp2; }';
  const mod=await import('data:text/javascript,'+encodeURIComponent(compile(source)));
  assert.equal(mod.main(20n,22n),42n);
  for(const trivia of [' // suspends susp ⧖ ∂',' /* suspends susp ⧖ ∂ */'])
    assert.equal(compile(source+trivia),compile(source));
});
