import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileToIR,compileIR} from '../src/compiler.mjs';
const corpus=JSON.parse(readFileSync(new URL('./fixtures/collection-subtypes-v1-candidate.json',import.meta.url),'utf8'));
const guest=async source=>import('data:text/javascript;base64,'+Buffer.from(compileIR(compileToIR(source))).toString('base64'));
const diagnostics={base_map_no_custom_method:/E_MAP_SUBTYPE_METHOD/,implicit_base_to_subtype:/E_MAP_SUBTYPE_CONVERSION/,implicit_sibling_to_subtype:/E_MAP_SUBTYPE_CONVERSION/,map_storage:/E_MAP_SUBTYPE_STORAGE/,map_builtin_slot:/E_MAP_SUBTYPE_METHOD/,generic_arity:/E_MAP_SUBTYPE_GENERIC/};
for(const v of corpus.cases.filter(v=>v.id==='map_custom_inherited'||Object.hasOwn(diagnostics,v.id))){
  test('exact Map candidate '+v.id,async()=>{
    if(v.expected.kind==='guest_int')assert.equal((await guest(v.source)).main(),BigInt(v.expected.value));
    else assert.throws(()=>compileToIR(v.source),diagnostics[v.id]);
  });
}
const decl='define class Scores extends Map<String,int> as pub bonus(int x):int{return self.size()+x;} end ';
const main=body=>'pub fnc main():int{'+body+'}';
test('empty and nonempty Map size, typed method argument and static base size',async()=>{
  const m=await guest(decl+main('const Scores a={};const Scores b={"x":1,"y":2};const Map<String,int> c={"z":1};return a.bonus(19)+b.bonus(20)+c.size();'));
  assert.equal(m.main(),42n);
});
test('runtime caller arguments and private scalar method emission',async()=>{
  const source=decl+'pub fnc run(int x):int{const Scores s={"a":1};return s.bonus(x);} '+main('return run(41);');
  const m=await guest(source);assert.equal(m.main(),42n);assert.equal(m.run(8n),9n);
  assert.equal(compileToIR(source).functions.filter(f=>!f.pub&&f.name.startsWith('_atto_record_method_')).length,1);
});
test('unsupported key, value, duplicate, mutation, escape, arity and implicit conversion',()=>{
  for(const [body,diagnostic] of [
    ['const Scores s={"x":1,"x":2};return 0;',/E_MAP_SUBTYPE_KEY/],
    ['const Scores s={x:1};return 0;',/E_MAP_SUBTYPE_KEY/],
    ['const Scores s={"x":true};return 0;',/E_MAP_SUBTYPE_VALUE/],
    ['const Scores s={"x":1};return s.bonus();',/E_MAP_SUBTYPE_ARITY/],
    ['const Scores s={"x":1};return s.bonus(1,2);',/E_MAP_SUBTYPE_ARITY/],
    ['const Scores s={"x":1};return s.put(1);',/E_MAP_SUBTYPE_METHOD/],
    ['const Scores s={"x":1};const Record r={...s};return 0;',/E_RECORD_SPREAD/],
    ['const Scores s={"x":1};const Scores t=s;return 0;',/E_MAP_SUBTYPE_CONVERSION/]
  ])assert.throws(()=>compileToIR(decl+main(body)),diagnostic);
  assert.throws(()=>compileToIR(decl+main('const Scores s={"x":1};return s;')));
});
test('Record cannot inherit a Map subtype; ordinary heap classes still denied',()=>{
  assert.throws(()=>compileToIR(decl+'define record Other extends Scores as end '+main('return 42;')),/E_RECORD_SUBTYPE_PARENT/);
  assert.throws(()=>compileToIR('define class Other as end '+main('return 42;')),/E_ACTOR_MEMORY_GUEST_UNSUPPORTED/);
});
