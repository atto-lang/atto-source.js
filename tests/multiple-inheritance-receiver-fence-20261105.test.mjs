import test from 'node:test';
import assert from 'node:assert/strict';
import {materializeMethodOnlyClass} from '../src/multiple-inheritance.mjs';

const defs=[
  {name:'Base',parents:[],fields:[],methods:[{name:'value',arity:0,pub:true,impl(){return 'base'}}]},
  {name:'Child',parents:['Base'],fields:[],methods:[{name:'value',arity:1,pub:true,impl(n){return n+1}}]}
];
test('value arity distinguishes inherited and local method slots',()=>{
  const lowered=materializeMethodOnlyClass(defs,'Child');
  const item=lowered.newInstance();
  assert.equal(item.value(),'base');
  assert.equal(item.value(4),5);
  assert.throws(()=>item.value(1,2),/arity mismatch/);
  assert.equal(lowered.isA(item,'Base'),true);
  assert.equal(lowered.isA(item,'Child'),true);
});
test('cloned prototype does not forge nominal instance identity',()=>{
  const lowered=materializeMethodOnlyClass(defs,'Child');
  const item=lowered.newInstance();
  const copy=Object.create(Object.getPrototypeOf(item));
  const method=Object.getPrototypeOf(item).value;
  assert.equal(lowered.isA(copy,'Child'),false);
  assert.throws(()=>method.call(copy),/invalid Oreslang receiver/);
  assert.equal(method.call(item),'base');
});
test('new lowering generation refuses previous brand even with identical definitions',()=>{
  const prior=materializeMethodOnlyClass(defs,'Child');
  const current=materializeMethodOnlyClass(defs,'Child');
  const oldItem=prior.newInstance();
  const newItem=current.newInstance();
  assert.equal(prior.isA(newItem,'Child'),false);
  assert.equal(current.isA(oldItem,'Child'),false);
  assert.equal(current.isA(newItem,'Base'),true);
  assert.equal(Object.isExtensible(newItem),false);
});
