import test from 'node:test';
import assert from 'node:assert/strict';
import {createScalarIR} from '../src/scalar-ir.mjs';
import {emitCold,ScalarEmissionSession} from '../src/scalar-emitter.mjs';
const int=n=>({kind:'int',n:BigInt(n)});
const variable=name=>({kind:'var',name});
const call=(name,...args)=>({kind:'call',name,args});
const plus=(left,right)=>({kind:'binary',op:'+',left,right});
const fn=(name,params,body,pub=false)=>({name,params,body,pub});
const closed=n=>createScalarIR([fn('helper',['x'],plus(variable('x'),int(n))),fn('main',[],call('helper',int(41)),true)]);
const bound=n=>createScalarIR([fn('provider',['x'],int(0)),fn('helper',['x'],plus(call('provider',variable('x')),int(n))),fn('main',[],call('helper',int(40)),true)]);
const load=code=>import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('closed checked-IR selective emission and byte-identical cold/warm guest',async()=>{
 const s=new ScalarEmissionSession(),a=s.emit(closed(1)),b=s.emit(closed(1)),c=s.emit(closed(2));
 assert.deepEqual([a.emitted,a.reused,b.emitted,b.reused,c.emitted,c.reused],[2,0,0,2,1,1]);
 assert.equal(a.code,emitCold(closed(1)));assert.equal(c.code,emitCold(closed(2)));
 assert.equal((await load(a.code)).main(),42n);assert.equal((await load(c.code)).main(),43n);
});
test('bound checked-IR omits provider body; stable fragments and independent bindings',async()=>{
 const s=new ScalarEmissionSession(),a=s.emit(bound(1),1),b=s.emit(bound(1),1),c=s.emit(bound(2),1);
 assert.deepEqual([a.emitted,a.reused,b.emitted,b.reused,c.emitted,c.reused],[2,0,0,2,1,1]);
 assert.equal(a.code,emitCold(bound(1),1));assert.equal(c.code,emitCold(bound(2),1));
 const old=(await load(a.code)).bindProvider([x=>x+1n]);
 const newer=(await load(a.code)).bindProvider([x=>x+2n]);
 assert.equal(old.main(),42n);assert.equal(newer.main(),43n);assert.equal(old.main(),42n);
 assert.equal((await load(c.code)).bindProvider([x=>x+1n]).main(),43n);
});
test('boundary change never reuses closed fragments in bound mode',async()=>{
 const s=new ScalarEmissionSession(),ir=bound(1),a=s.emit(ir,0),b=s.emit(ir,1);
 assert.deepEqual([a.emitted,b.emitted,b.reused],[3,2,0]);
 assert.equal(b.code,emitCold(ir,1));assert.equal((await load(b.code)).bindProvider([x=>x+1n]).main(),42n);
});
test('malformed external slots and failed IR checks leave prior session unchanged',()=>{
 const s=new ScalarEmissionSession(),ir=bound(1);s.emit(ir,1);
 for(const count of [-1,0.5,3,129,NaN])assert.throws(()=>s.emit(ir,count),/invalid external scalar slot/);
 const pub=structuredClone(ir);pub.functions[0].pub=true;assert.throws(()=>s.emit(pub,1),/invalid external scalar slot/);
 const body=structuredClone(ir);body.functions[0].body.value='1';assert.throws(()=>s.emit(body,1),/invalid external scalar slot/);
 const arity=structuredClone(ir);arity.functions[1].body.left.args=[];assert.throws(()=>s.emit(arity,1),/call arity mismatch/);
 const recovered=s.emit(ir,1);assert.deepEqual([recovered.emitted,recovered.reused],[0,2]);
});
test('slot shift and export changes reconstruct complete emitted module',async()=>{
 const s=new ScalarEmissionSession();s.emit(bound(1),1);
 const shifted=createScalarIR([fn('provider',['x'],int(0)),fn('extra',[],int(0)),fn('helper',['x'],plus(call('provider',variable('x')),int(1))),fn('entry',[],call('helper',int(40)),true)]);
 const r=s.emit(shifted,1);assert.deepEqual([r.emitted,r.reused],[3,0]);assert.equal(r.code,emitCold(shifted,1));
 const api=(await load(r.code)).bindProvider([x=>x+1n]);assert.deepEqual(Object.keys(api),['entry']);assert.equal(api.entry(),42n);
});
test('provider binding arity and integer boundary enforced in generated ESM',async()=>{
 const ns=await load(emitCold(bound(1),1));assert.throws(()=>ns.bindProvider([]),/invalid provider bindings/);
 assert.throws(()=>ns.bindProvider([42]),/missing provider binding/);assert.throws(()=>ns.bindProvider([()=>42]).main(),/signed i64 BigInt/);
 assert.throws(()=>ns.bindProvider([()=>1n<<63n]).main(),/signed i64 BigInt/);
});
