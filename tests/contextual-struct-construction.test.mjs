import test from 'node:test';
import assert from 'node:assert/strict';
import {planContextualMake} from '../src/contextual-struct-construction.mjs';
const owner={fields:[{name:'x',type:'int'},{name:'y',type:'bool'}],ctors:[{id:'_c0',formals:[{type:'bool'},{type:'int'}],fieldParams:[1,0]}]};
const x={name:'x',type:'int'},y={name:'y',type:'bool'};
test('canonical constructor order does not change source evaluation order',()=>{
  assert.deepEqual(planContextualMake(owner,[x,y]),{id:'_c0',order:[1,0]});
  assert.deepEqual(planContextualMake(owner,[y,x]),{id:'_c0',order:[0,1]});
  assert.deepEqual(owner.ctors[0].fieldParams,[1,0]);
});
test('incomplete, duplicate, unknown, mistyped and unresolved fields fail closed',()=>{
  for(const entries of [[x],[x,x],[x,{name:'z',type:'bool'}],[x,{...y,type:'int'}],[x,y,y]])
    assert.throws(()=>planContextualMake(owner,entries),/E_ATTACHED_STRUCT/);
  assert.throws(()=>planContextualMake(null,[x,y]),/E_ATTACHED_STRUCT/);
});
test('no implicit constructor bypass or ambiguous selection',()=>{
  for(const ctors of [[],[{...owner.ctors[0],fieldParams:[0,0]}],[{...owner.ctors[0],fieldParams:[0,1]}],[...owner.ctors,...owner.ctors]])
    assert.throws(()=>planContextualMake({...owner,ctors},[x,y]),/E_ATTACHED_STRUCT/);
});
