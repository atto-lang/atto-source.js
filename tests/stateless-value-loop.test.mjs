import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileProgramV2} from '../src/program-v2.mjs';
let seq=0;
async function run(source){
 const js=compileProgramV2(source);
 const uri='data:text/javascript;base64,'+Buffer.from(js+'\n// unique '+seq++).toString('base64');
 return (await import(uri)).main();
}
test('exact shared stateless loop guest returns 42',async()=>{
 const b=readFileSync(new URL('fixtures/230-stateless-value-loop.atto',import.meta.url));
 assert.equal(createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex'),'2c0359a6d2876958d6fb6831eb0dac3c6548c15b');
 assert.equal(await run(b.toString('utf8')),42n);
});
test('arithmetic, lazy branch and nested computed loop',async()=>{
 for(const body of ['loop { break 20+22; }','true ? loop { break 42; } : loop { break 9223372036854775807+1; }','loop { break loop { break 42; }; }']){
  assert.equal(await run('pub fnc main(): int { return '+body+'; }'),42n);
 }
});
test('invalid loop forms and computed call designator fail closed',()=>{
 for(const body of ['loop { break; }','loop { break 42; break 1; }','loop { break f; }','loop { break 42; }(1)','loop (val i:int=0) { break i; }']){
  assert.throws(()=>compileProgramV2('fnc f(int a):int{return a;} pub fnc main():int{return '+body+';}'));
 }
});
