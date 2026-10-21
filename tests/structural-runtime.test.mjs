import test from 'node:test';
import assert from 'node:assert/strict';
import {createStructuralDomain} from '../src/structural-runtime.mjs';
const fld=(name,type,publicly=true)=>({name,type,public:publicly});
const view=fields=>({kind:'interface',readOnly:true,fields});

test('readonly structural width executes through compiler-indexed typed slots',()=>{
 const d=createStructuralDomain();
 const t=d.defineType({kind:'class',name:'Person',fields:[fld('id','int'),fld('label','string'),fld('secret','bool',false)]});
 const x=d.createValue(t,[42n,'hello',true]);
 const p=d.compileView(t,view([fld('label','string'),fld('id','int')]));
 assert.equal(d.withView(x,p,v=>v.id+BigInt(v.label.length)),47n);
 assert.deepEqual(d.withView(x,p,v=>Object.keys(v).join(',')),'label,id');
 assert.equal(d.withView(x,p,v=>v.secret),undefined);
});
test('loan expires after synchronous callback, and view cannot escape via return',()=>{
 const d=createStructuralDomain();
 const t=d.defineType({kind:'record',fields:[fld('id','int')]});
 const p=d.compileView(t,view([fld('id','int')]));
 const x=d.createValue(t,[1n]);
 let leaked;
 assert.equal(d.withView(x,p,v=>{leaked=v;return v.id;}),1n);
 assert.throws(()=>leaked.id,/expired structural view loan/);
 assert.throws(()=>d.withView(x,p,v=>v),/must be scalar\/non-escaping/);
 assert.throws(()=>d.withView(x,p,async v=>v.id),/must be scalar\/non-escaping/);
});
test('no writable alias, incorrect slot layout, or actor shape erasure',()=>{
 const d=createStructuralDomain();
 const t=d.defineType({kind:'record',fields:[fld('id','int'),fld('hidden','string',false)]});
 const x=d.createValue(t,[1n,'no']);
 const p=d.compileView(t,view([fld('id','int')]));
 assert.throws(()=>d.withView(x,p,v=>{v.id=2n;}),TypeError);
 assert.throws(()=>d.compileView(t,view([fld('hidden','string')])),/type proof failed/);
 assert.throws(()=>d.compileView(t,view([fld('id','string')])),/type proof failed/);
 assert.throws(()=>d.compileView(t,{kind:'interface',readOnly:false,fields:[fld('id','int')]}),/unsupported view plan/);
 assert.throws(()=>d.createValue(t,[1,'no']),/slot type mismatch/);
 assert.throws(()=>d.createValue(t,[1n]),/slot arity/);
 assert.throws(()=>d.defineType({kind:'class',name:'Agent',actor:true,fields:[]}),/unsupported/);
 assert.throws(()=>d.withView(Object.freeze({}),p,()=>1),/forged/);
 assert.throws(()=>d.withView(x,Object.freeze({}),()=>1),/forged/);
});
test('named struct, empty shape vs scalar, and provenance stay explicit',()=>{
 const d=createStructuralDomain();
 const t=d.defineType({kind:'struct',name:'Point',fields:[fld('x','int'),fld('y','int')]});
 const x=d.createValue(t,[5n,8n]);
 assert.equal(d.withView(x,d.compileView(t,view([fld('x','int')])),v=>v.x),5n);
 const empty=d.defineType({kind:'record',fields:[]});
 assert.equal(d.withView(d.createValue(empty,[]),d.compileView(empty,view([])),()=>17),17);
 assert.throws(()=>d.compileView(Object.freeze({}),view([])),/unsupported view|type proof/);
});
test('adversarial getter metadata never executes and mutable input cannot mutate compiled plan',()=>{
 const d=createStructuralDomain();
 let reads=0;
 const evil=Object.create(null);
 Object.defineProperty(evil,'fields',{enumerable:true,get(){reads++;throw Error('executed');}});
 assert.throws(()=>d.defineType(evil),/accessors/);
 assert.equal(reads,0);
 const t=d.defineType({kind:'record',fields:[fld('id','int')]});
 const expected=view([fld('id','int')]);
 const p=d.compileView(t,expected);
 expected.fields[0].name='other';
 assert.equal(d.withView(d.createValue(t,[7n]),p,v=>v.id),7n);
});
test('sparse, accessor-backed, extra-key and custom-prototype arrays fail closed',()=>{
 const d=createStructuralDomain();
 const sparse=Array(1);
 assert.throws(()=>d.defineType({kind:'record',fields:sparse}),/sparse/);
 const getter=[{name:'id',type:'int',public:true}];
 Object.defineProperty(getter,'0',{get(){throw Error('getter invoked')},enumerable:true});
 assert.throws(()=>d.defineType({kind:'record',fields:getter}),/array getters forbidden/);
 const t=d.defineType({kind:'record',fields:[fld('id','int')]});
 const slots=[1n];slots.intruder=2n;
 assert.throws(()=>d.createValue(t,slots),/noncanonical/);
 assert.throws(()=>d.defineType({kind:'record',fields:Object.setPrototypeOf([fld('id','int')],null)}),/untrusted array/);
});
