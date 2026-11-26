import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveScalarClosure} from '../src/scalar-transitive-plan.mjs';
import {scalarInterface,} from '../src/scalar-package-interface.mjs';
const api=[{name:'value',params:[],resultType:'int'}];
const abi=scalarInterface(api,'edge-js').sha256;
const edge=(packageId,alias='value')=>({packageId,interfaceSha256:abi,imports:[{alias,exportName:'value',params:[]}]});
const node=(packageId,dependencies=[],moduleSha256='b'.repeat(64))=>({packageId,dependencies,moduleSha256,manifestSha256:'a'.repeat(64),publicInterface:api});
const diamond=[node('app',[edge('left','left'),edge('right','right')]),node('left',[edge('shared')]),node('right',[edge('shared')]),node('shared')];
test('diamond closure orders dependencies once and is independent of input order',()=>{
 const p=resolveScalarClosure('app',diamond);assert.deepEqual(p.order,['shared','left','right','app']);
 assert.deepEqual(p,resolveScalarClosure('app',[...diamond].reverse()));
 assert.deepEqual(p,resolveScalarClosure('app',[{...diamond[0],dependencies:[...diamond[0].dependencies].reverse()},...diamond.slice(1)]));
});
test('body update changes lock but preserves ordering',()=>{
 const p=resolveScalarClosure('app',diamond),q=resolveScalarClosure('app',[...diamond.slice(0,3),node('shared',[],'c'.repeat(64))]);
 assert.deepEqual(p.order,q.order);assert.notEqual(p.lockSha256,q.lockSha256);
});
test('self and indirect cycles denied',()=>{
 assert.throws(()=>resolveScalarClosure('a',[node('a',[edge('a')])]),/cycle/);
 assert.throws(()=>resolveScalarClosure('a',[node('a',[edge('b')]),node('b',[edge('a')])]),/cycle/);
});
test('missing, duplicate and unreachable nodes denied',()=>{
 assert.throws(()=>resolveScalarClosure('app',diamond.slice(0,3)),/missing dependency/);
 assert.throws(()=>resolveScalarClosure('app',[...diamond,diamond[3]]),/duplicate/);
 assert.throws(()=>resolveScalarClosure('app',[...diamond,node('unused')]),/unreachable/);
 assert.throws(()=>resolveScalarClosure('absent',diamond),/missing root/);
});
test('incompatible transitive interface and forged signature denied',()=>{
 assert.throws(()=>resolveScalarClosure('app',[...diamond.slice(0,3),{...diamond[3],publicInterface:[{...api[0],params:['x']}]}]),/ABI mismatch/);
 const wrong={...edge('shared'),imports:[{alias:'value',exportName:'value',params:['x']}]};
 assert.throws(()=>resolveScalarClosure('app',[diamond[0],node('left',[wrong]),...diamond.slice(2)]),/signature mismatch/);
});
test('versioned identities remain distinct, no implicit fallback',()=>{
 const a=node('root',[edge('pkg@1','one'),edge('pkg@2','two')]);
 assert.deepEqual(resolveScalarClosure('root',[a,node('pkg@1'),node('pkg@2')]).order,['pkg@1','pkg@2','root']);
 assert.throws(()=>resolveScalarClosure('root',[a,node('pkg@1'),node('pkg@3')]),/missing dependency/);
});
test('inventory and edge budgets fail closed',()=>{
 assert.throws(()=>resolveScalarClosure('app',Array.from({length:65},(_,i)=>node('p'+i))),/inventory/);
 const inventory=Array.from({length:33},(_,i)=>node('p'+i));
 for(let i=0;i<17;i++)inventory[i].dependencies=Array.from({length:32},(_,j)=>edge('p'+(j+1),'x'+j));
 assert.throws(()=>resolveScalarClosure('p0',inventory),/edge budget/);
});
