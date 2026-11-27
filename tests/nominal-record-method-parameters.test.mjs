import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileToIR,compileIR} from '../src/compiler.mjs';
const corpus=JSON.parse(readFileSync(new URL('./fixtures/collection-subtypes-v1-candidate.json',import.meta.url),'utf8'));
const guest=async source=>import('data:text/javascript;base64,'+Buffer.from(compileIR(compileToIR(source))).toString('base64'));
const diagnostics={record_field_shadow:/E_RECORD_SUBTYPE_FIELD/,record_wrong_field_type:/E_RECORD_SUBTYPE_SHAPE/,record_missing_field:/E_RECORD_SUBTYPE_SHAPE/};
for(const vector of corpus.cases.filter(v=>v.scenario.startsWith('R'))){
  test('exact candidate '+vector.id,async()=>{
    if(vector.expected.kind==='guest_int') assert.equal((await guest(vector.source)).main(),BigInt(vector.expected.value));
    else {assert.ok(diagnostics[vector.id]);assert.throws(()=>compileToIR(vector.source),diagnostics[vector.id]);}
  });
}
const person='define record Person extends Record as int age; pub add(int delta):int{return self.age+delta;} pub scaled(int age,int factor):int{return self.age+age*factor;} end ';
const child='define record Employee extends Person as int salary; end ';
const main=body=>'pub fnc main():int{'+body+'}';
test('inherited arguments, field shadowing and runtime caller inputs',async()=>{
  const m=await guest(person+child+'pub fnc run(int delta):int{const Employee e=(age=18,salary=2);return e.add(delta)+e.scaled(2,3);} '+main('return run(0);'));
  assert.equal(m.main(),42n);assert.equal(m.run(7n),49n);
});
test('argument expression uses existing checked scalar lowering',async()=>{
  const m=await guest(person+main('const Person p=(age=20);return p.add(11*2);'));
  assert.equal(m.main(),42n);
});
test('arity and parameter authority failures reject before IR',()=>{
  for(const body of ['const Person p=(age=42);return p.add();','const Person p=(age=42);return p.add(0,1);'])
    assert.throws(()=>compileToIR(person+main(body)),/E_RECORD_SUBTYPE_ARITY/);
  for(const member of ['pub bad(int x,int x):int{return x;}','pub bad(int self):int{return 42;}','pub bad(int Person):int{return 42;}'])
    assert.throws(()=>compileToIR('define record Person extends Record as '+member+' end '+main('return 42;')));
  for(const expr of ['x()','x.field','missing'])assert.throws(()=>compileToIR('define record Person extends Record as pub bad(int x):int{return '+expr+';} end '+main('return 42;')),/E_RECORD_SUBTYPE_BODY/);
});
