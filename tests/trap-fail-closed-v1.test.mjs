import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  compileProgramV2,compileToProgramIRV2,ProgramCompileError
} from '../src/program-v2.mjs';
import {compileFreestandingCore} from '../src/freestanding-core.mjs';

const root=new URL('./fixtures/trap-fail-closed-v1/',import.meta.url);
const fixture=name=>readFile(new URL(name,root),'utf8');

test('JS scalar and tagged Option/Result remain supported without trap',async()=>{
  const source=await fixture('scalar-and-trivia.atto');
  const code=compileProgramV2(source);
  const ns=await import('data:text/javascript,'+encodeURIComponent(code));
  assert.equal(ns.main(),42n);
  // This is an independent *tagged-value* positive control, not a trap guest.
  const core=await readFile(new URL('./fixtures/core-option-result.ores',import.meta.url),'utf8');
  const esm=compileFreestandingCore(core);
  const generated=await import('data:text/javascript,'+encodeURIComponent(esm));
  assert.equal(generated.core.negative(-3n).kind,'Err');
  assert.equal(generated.core.positive(-3n).kind,'None');
  assert.equal(generated.core.negative(3n).kind,'Ok');
  assert.equal(generated.core.positive(3n).kind,'Some');
});

test('trap is rejected in program IR and ESM paths before any guest emission',async()=>{
  for(const name of [
    'trap-expression.atto','trap-function.atto',
    'trap-nested.atto','trap-result.atto'
  ]){
    const source=await fixture(name);
    for(const compile of [compileToProgramIRV2,compileProgramV2]){
      assert.throws(()=>compile(source),error=>{
        assert.ok(error instanceof ProgramCompileError,name);
        assert.match(error.message,/trap requires verified ordinary-throw effect and cleanup lowering/);
        assert.match(error.message,/at [0-9]+:[0-9]+/);
        return true;
      },name);
    }
  }
});
