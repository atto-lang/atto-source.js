import test from 'node:test';
import assert from 'node:assert/strict';
import {planMultipleInheritance,materializeMethodOnlyClass} from '../src/multiple-inheritance.mjs';

const cls=(name,parents=[],methods=[],fields=[])=>({name,parents,methods,fields});
const meth=(name,arity,impl=()=>42,pub=true)=>({name,arity,pub,impl});

test('diamond method inheritance selects the most-specific contributor, independent of graph order',()=>{
 const defs=[
  cls('Root',[],[meth('value',0,()=>1)]),
  cls('Left',['Root'],[meth('value',0,()=>2)]),
  cls('Right',['Root']),
  cls('Leaf',['Right','Left'])
 ];
 const p=planMultipleInheritance(defs,'Leaf');
 assert.equal(p.methods.find(m=>m.slot==='value/0').owner,'Left');
 assert.deepEqual(p.ancestors,['Left','Right','Root']);
 assert.equal(p.methods.find(m=>m.slot==='value/0').impl(),2);
});

test('unrelated parents require explicit public override and cannot collide on field storage',()=>{
 const base=[cls('A',[],[meth('value',0,()=>1)]),cls('B',[],[meth('value',0,()=>2)])];
 assert.throws(()=>planMultipleInheritance([...base,cls('Child',['A','B'])],'Child'),/ambiguous inherited method/);
 assert.throws(()=>planMultipleInheritance([...base,cls('Child',['A','B'],[meth('value',0,()=>3,false)])],'Child'),/override cannot hide public/);
 const p=planMultipleInheritance([...base,cls('Child',['A','B'],[meth('value',0,()=>3)])],'Child');
 assert.equal(p.methods.find(m=>m.slot==='value/0').owner,'Child');
 assert.throws(()=>planMultipleInheritance([
  cls('A',[],[],['field']),cls('B',[],[],['field']),cls('Child',['A','B'])
 ],'Child'),/colliding field/);
});

test('method-only nominal brands cannot be forged or reused across independently built classes',()=>{
 const defs=[cls('Parent',[],[meth('ping',0,()=>7),meth('ping',1,n=>n)]),cls('Child',['Parent'])];
 const a=materializeMethodOnlyClass(defs,'Child');
 const b=materializeMethodOnlyClass(defs,'Child');
 const instance=a.newInstance(),other=b.newInstance();
 assert.equal(instance.ping(),7);
 assert.equal(instance.ping(3),3);
 assert.equal(a.isA(instance,'Parent'),true);
 assert.equal(a.isA(other,'Child'),false);
 assert.throws(()=>instance.ping(1,2),/arity mismatch/);
 assert.throws(()=>instance.ping.call(other),/invalid Oreslang receiver/);
 assert.throws(()=>instance.ping.call(Object.create(Object.getPrototypeOf(instance))),/invalid Oreslang receiver/);
});
