import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compile, compileToIR} from '../src/compiler.mjs';
import {compileProgramV2, compileToProgramIRV2} from '../src/program-v2.mjs';
const frontends = [compile, compileToIR, compileProgramV2, compileToProgramIRV2];
test('unlowered grouped spawn denied before JS emission',()=>{
 for(const expr of [
   'spawn Worker()', 'spawn Worker() with {}',
   'spawn Worker() with { schedule { max_parallelism = 2; } }',
   'spawn Worker() with { resources { heap_size = 1024; } }',
   'spawn Worker() with { init { seed = 42; } }',
   'spawn /* trivia */ Worker() with { init {} }'
 ]) for(const f of frontends)
   assert.throws(()=>f('pub fnc main():int{return '+expr+';}'),/E_SPAWN_OPTIONS_UNSUPPORTED/,expr);
});
test('spawn lookalikes in comments and longer names remain inert',()=>{
 const source='pub fnc spawn_count():int{return 42;} pub fnc main():int{return spawn_count();} // spawn Worker() with {}\n';
 for(const f of frontends) assert.doesNotThrow(()=>f(source));
});
