import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileVerifiedStrict} from '../src/program-v2.mjs';
const pre='type Bounded = int where self >= 1 and self <= 42; ';
const source=(a,k,o,c,arg)=>pre+a+'fnc f(int x) -> int '+k+o+' return 84 / x; '+c+' pub fnc main() -> int { return f('+arg+'); }';
const forms=[[' {','}'],['\nbegin','end'],[' ::','end'],['\n::','end']];
test('bounded strict annotations equal keyword ESM and preserve call denial',async()=>{
 for(const [o,c] of forms){
  const baseline=compileVerifiedStrict(source('','requires x != 0 requires x != -1',o,c,2));
  for(const [a,k] of [['@requires(x != 0)\n@requires(x != -1)\n',''],['@requires(x != 0)\n','requires x != -1'],['@requires(x != -1)\n','requires x != 0']]){
   const esm=compileVerifiedStrict(source(a,k,o,c,2));
   assert.equal(esm,baseline);
   const guest=await import('data:text/javascript;base64,'+Buffer.from(esm).toString('base64'));
   assert.equal(guest.main(),42n);
   for(const x of [0,-1])assert.throws(()=>compileVerifiedStrict(source(a,k,o,c,x)),/E_REFINEMENT_PRECONDITION:/);
  }
 }
});
test('annotation postconditions use ordinary bounded prover',async()=>{
 for(const [o,c] of forms){
  const a='@requires(x >= 1)\n@ensures(result <= 84)\n',k='requires x <= 42';
  const esm=compileProgramV2(source(a,k,o,c,2));
  const guest=await import('data:text/javascript;base64,'+Buffer.from(esm).toString('base64'));
  assert.equal(guest.main(),42n);
  assert.throws(()=>compileProgramV2(source(a.replace('<= 84','<= 1'),k,o,c,2)),/E_REFINEMENT_POSTCONDITION:/);
  assert.throws(()=>compileVerifiedStrict(source(a,k,o,c,2)),/E_VERIFY_UNSUPPORTED:/);
 }
});
test('invalid bounded annotation predicates and budget fail closed',()=>{
 for(const [a,k] of [['@requires(x != 0)\n','requires x == 0'],['@requires(x != 3)\n',''],['@requires(x != 0 && x != -1)\n',''],['@foo(x != 0)\n',''],['@requires(x != 0\n',''],['@requires(x != 0)\n'.repeat(17),'']])
   assert.throws(()=>compileVerifiedStrict(source(a,k,' ::','end',2)));
 assert.throws(()=>compileVerifiedStrict(source('@requires(x != 0)\n','requires x != -1',' begin','end',2)),/E_SYNTAX:/);
 assert.throws(()=>compileProgramV2('@foo(1) pub fnc main() -> int { return 42; }'));
});
