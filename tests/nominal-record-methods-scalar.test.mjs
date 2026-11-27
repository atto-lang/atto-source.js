import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIR,compileIR} from '../src/compiler.mjs';
const person='define record Person extends Record as int age; pub years(): int { return self.age; } end ';
const employee='define record Employee extends Person as int salary; pub annual_salary(): int { return self.salary * 12; } end ';
const main=body=>'pub fnc main(): int { '+body+' }';
const guest=async source=>import('data:text/javascript;base64,'+Buffer.from(compileIR(compileToIR(source))).toString('base64'));
test('nominal Record custom method and inherited scalar slots execute emitted ESM',async()=>{
  assert.equal((await guest(person+main('const Person p=(age=42);return p.years();'))).main(),42n);
  assert.equal((await guest(person+employee+main('const Employee e=(salary=2,age=18);return e.years()+e.annual_salary();'))).main(),42n);
  assert.equal((await guest(person+main('const Person p={age:=40};return p.age+2;'))).main(),42n);
});
test('immutable runtime scalar parameter is passed into actual static method',async()=>{
  const m=await guest(person+'pub fnc process(int x):int {const Person p=(age=x);return p.years();} '+main('return process(42);'));
  assert.equal(m.main(),42n);assert.equal(m.process(19n),19n);
});
test('method uses existing checked scalar IR rather than host evaluation',async()=>{
  const source=person+employee+main('const Employee e=(salary=2,age=18);return e.years()+e.annual_salary();');
  const ir=compileToIR(source);
  assert.equal(ir.functions.filter(f=>!f.pub&&f.name.startsWith('_atto_record_method_')).length,2);
  assert.equal((await guest(source)).main(),42n);
});
test('nominal shape validation and wrong receiver reject before IR',()=>{
  for(const body of [
    'const Person p=(age=true);return p.years();',
    'const Person p=();return p.years();',
    'const Person p=(age=42,salary=1);return p.years();'
  ])assert.throws(()=>compileToIR(person+main(body)),/E_RECORD_SUBTYPE_SHAPE/);
  assert.throws(()=>compileToIR(person+main('const Record p=(age=42);return p.years();')),/E_NO_FIELD/);
  assert.throws(()=>compileToIR(person+main('const Person p=(age=42);return p.absent();')),/E_RECORD_SUBTYPE_METHOD/);
  assert.throws(()=>compileToIR(person+main('const Record r=(age=42);const Person p=r;return p.years();')));
  assert.throws(()=>compileToIR(person+main('const Person p=(age=42);const r={...p};return r.age;')),/E_RECORD_SPREAD/);
});
test('field collisions, unavailable parent, overrides and invalid unused bodies reject',()=>{
  for(const [declaration,reason] of [
    ['define record Child extends Person as int age; end ',/E_RECORD_SUBTYPE_FIELD/],
    ['define record Child extends Person as pub years():int{return 0;} end ',/E_RECORD_SUBTYPE_METHOD/],
    ['define record Child extends Missing as end ',/E_RECORD_SUBTYPE_PARENT/],
    ['define record Child extends Child as end ',/E_RECORD_SUBTYPE_PARENT/],
    ['define record Child extends Person as pub invalid():int{return self.missing;} end ',/E_NO_FIELD/],
    ['define record Child extends Person as pub invalid():int{return other();} end ',/E_RECORD_SUBTYPE_BODY/]
  ])assert.throws(()=>compileToIR(person+declaration+main('return 42;')),reason);
});
test('no direct calls or exports to compiler-generated helper names',()=>{
  assert.throws(()=>compileToIR(person+main('return _atto_record_method_0(42);')),/E_RECORD_SUBTYPE_NAME/);
  assert.throws(()=>compileToIR(person+'export pub fnc _atto_record_method_0; '+main('return 42;')),/E_RECORD_SUBTYPE_NAME/);
});
test('ordinary aggregate and function behavior remains unchanged',async()=>{
  assert.equal((await guest(main('const Record r=(age=42);return r.age;'))).main(),42n);
});
