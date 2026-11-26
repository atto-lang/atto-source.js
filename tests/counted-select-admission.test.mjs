import test from 'node:test';
import assert from 'node:assert/strict';
import {compile,compileToIR} from '../src/compiler.mjs';
test('canonical counted select and typed aliases cannot emit scalar IR or JS',()=>{
  for(const prefix of ['select','nb select','await select','await nb select'])
    for(const header of ['(3)','<int>(3)',' /* count */ (0)','(-1)','(true)','(1 + 2)'])
      for(const body of ['{ default: -> { return 42; } }','over default: -> { return 42; } end']) {
        const source='pub fnc main(): int { return '+prefix+header+' '+body+'; }';
        for(const compiler of [compile,compileToIR])
          assert.throws(()=>compiler(source),/static select requires checked Channel\/Future arbitration/,source);
      }
});
test('comments and longer names do not reserve unrelated scalar source',()=>{
  assert.doesNotThrow(()=>compile('pub fnc selection(): int { return 42; } pub fnc main(): int { /* select<int>(3) */ return selection(); }'));
  assert.doesNotThrow(()=>compile('fnc select(int n): int { return n; } pub fnc main(): int { return select((3 + 4)); }'));
});
