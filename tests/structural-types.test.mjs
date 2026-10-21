import test from 'node:test';
import assert from 'node:assert/strict';
import {canBorrowStructural, canAssignNominal, canImplementMethod} from '../src/structural-types.mjs';
const field=(name,type,publicly=true)=>({name,type,public:publicly});
const shape=(kind,fields,extra={})=>({kind,fields,...extra});
const expect=fields=>shape('interface',fields,{readOnly:true});
const t=(...elements)=>({kind:'tuple',elements});
const v=name=>({kind:'var',name});
const method=(generic,params,result,extra={})=>({name:'echo',generics:[generic],params:params.map(type=>({type,mutable:false})),result,public:true,...extra});

test('readonly width only; no nominal erosion or numeric reinterpretation',()=>{
 const extra=shape('class',[field('id','int'),field('label','string')]);
 assert.equal(canBorrowStructural(extra,expect([field('id','int')])),true);
 assert.equal(canBorrowStructural(extra,expect([field('id','float')])),false);
 assert.equal(canBorrowStructural(extra,{...expect([field('id','int')]),readOnly:false}),false);
 assert.equal(canBorrowStructural(extra,{...expect([]),mutable:true}),false);
 assert.equal(canAssignNominal(extra,expect([field('id','int')])),false);
 assert.equal(canAssignNominal({...extra,name:'First'}, {...extra,name:'Second'}),false);
 assert.equal(canAssignNominal({...extra,name:'First'}, {...extra,name:'First'}),true);
 assert.equal(canAssignNominal(shape('record',[field('x','int')],{readOnly:true}),shape('record',[field('x','int')])),false);
 assert.equal(canBorrowStructural({...extra,actor:true},expect([])),false);
 assert.equal(canBorrowStructural(shape('class',[field('id','int',false)]),expect([field('id','int')])),false);
 assert.equal(canBorrowStructural('int',expect([])),false);
});
test('nominal Entry tag and structural projection are distinct',()=>{
 const entry={kind:'entry',args:['int','string']};
 assert.equal(canBorrowStructural(entry,expect([field('key','int'),field('value','string')])),true);
 assert.equal(canBorrowStructural(entry,expect([field('key','float')])),false);
 assert.equal(canAssignNominal(shape('record',[field('key','int'),field('value','string')]),entry),false);
});
test('tuple slots are exact and mutable fixed arrays invariant',()=>{
 const pair=t('int','string');
 assert.equal(canBorrowStructural(pair,{...t('int','string'),readOnly:true}),true);
 assert.equal(canBorrowStructural(pair,{...t('float','string'),readOnly:true}),false);
 assert.equal(canBorrowStructural(pair,{...t('int'),readOnly:true}),false);
 assert.equal(canBorrowStructural({kind:'fixed-array',elements:['int','string']},{...t('int','string'),readOnly:true}),false);
 const derived={kind:'nominal',name:'Derived',args:[],ancestors:['Base']};
 const base={kind:'nominal',name:'Base',args:[]};
 assert.equal(canAssignNominal(t(derived),t(base)),false); // inline ancestor hints are untrusted
 assert.equal(canAssignNominal({kind:'fixed-array',elements:[derived]},{kind:'fixed-array',elements:[base]}),false);
 assert.equal(canAssignNominal({kind:'fixed-array',elements:['int'],readOnly:true},{kind:'fixed-array',elements:['int']}),false);
});
test('generic method alpha-equivalence and nested invariance',()=>{
 assert.equal(canImplementMethod(method('U',[v('U')],v('U')),method('T',[v('T')],v('T'))),true);
 const option=n=>({kind:'nominal',name:'Option',args:[v(n)]});
 assert.equal(canImplementMethod(method('Right',[option('Right')],option('Right')),method('Left',[option('Left')],option('Left'))),true);
 assert.equal(canImplementMethod(method('U',[v('U')],'int'),method('T',[v('T')],v('T'))),false);
 assert.equal(canImplementMethod({...method('U',[v('U')],v('U')),generics:['U','V']},method('T',[v('T')],v('T'))),false);
 assert.equal(canImplementMethod(method('U',[v('U')],v('U'),{async:true}),method('T',[v('T')],v('T'))),false);
 assert.equal(canImplementMethod(method('U',[v('U')],v('U'),{public:false}),method('T',[v('T')],v('T'))),false);
});
test('nominal receiver method variance is sound',()=>{
 const base={kind:'nominal',name:'Base',args:[]};
 const child={kind:'nominal',name:'Child',args:[],ancestors:['Base']};
 const actual={name:'handle',generics:[],params:[{type:base}],result:child,public:true};
 const contract={name:'handle',generics:[],params:[{type:child}],result:base};
 assert.equal(canImplementMethod(actual,contract),false); // no sealed inheritance proof yet
 assert.equal(canImplementMethod({...actual,result:base},{...contract,params:[{type:base}]}),true);
 assert.equal(canImplementMethod(contract,actual),false);
 assert.equal(canImplementMethod({...actual,name:'other'},contract),false);
});
test('safe failure on untrusted metadata, getters, cycles, arbitrary host objects',()=>{
 const evil=Object.create(null);
 Object.defineProperty(evil,'kind',{get(){throw Error('host getter executed')}});
 assert.equal(canBorrowStructural(evil,expect([])),false);
 const cyclic={kind:'record',fields:[]};cyclic.fields.push(field('self',cyclic));
 assert.equal(canBorrowStructural(cyclic,expect([field('self',cyclic)])),false);
 assert.equal(canBorrowStructural({kind:'class',fields:[field('__proto__','int')]},expect([])),false);
 assert.equal(canBorrowStructural(new Date(),expect([])),false);
});

test('accessor-backed nested metadata arrays never execute or establish a proof',()=>{
 let called=0;
 const fields=[{name:'id',type:'int',public:true}];
 Object.defineProperty(fields,'0',{get(){called++;return {name:'id',type:'int',public:true};},enumerable:true});
 const target=expect([field('id','int')]);
 assert.equal(canBorrowStructural(shape('record',fields),target),false);
 const methods=[{name:'echo',params:[],generics:[],result:'int',public:true}];
 Object.defineProperty(methods,'0',{get(){called++;return {name:'echo',params:[],generics:[],result:'int',public:true};},enumerable:true});
 assert.equal(canBorrowStructural({kind:'record',fields:[],methods},expect([])),false);
 const params=[{type:'int'}];
 Object.defineProperty(params,'0',{get(){called++;return {type:'int'};},enumerable:true});
 assert.equal(canImplementMethod({name:'echo',params,generics:[],result:'int',public:true},{name:'echo',params:[{type:'int'}],generics:[],result:'int'}),false);
 assert.equal(called,0);
});
test('generic signature proof requires dense ordinary parameter and binder metadata',()=>{
 const good={name:'echo',params:[{type:{kind:'var',name:'U'}}],generics:['U'],result:{kind:'var',name:'U'},public:true};
 const expected={...good,generics:['T'],params:[{type:{kind:'var',name:'T'}}],result:{kind:'var',name:'T'}};
 assert.equal(canImplementMethod(good,expected),true);
 assert.equal(canImplementMethod({...good,generics:['U','U']},expected),false);
 const sparse=[,{type:'int'}];
 assert.equal(canImplementMethod({...good,params:sparse},{...expected,params:[{type:'int'},{type:'int'}]}),false);
 const weird=Object.setPrototypeOf([...(good.generics)],null);
 assert.equal(canImplementMethod({...good,generics:weird},expected),false);
});

test('deterministic 25000 random shape trials preserve readonly/subset property',()=>{
 let seed=0x5eed1234;
 const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)>>>8)/16777216;
 for(let i=0;i<25000;i++){
  const len=1+Math.floor(random()*8), chosen=Math.floor(random()*len);
  const fields=Array.from({length:len},(_,j)=>field('f'+j,random()<0.5?'int':'string'));
  const want=expect([fields[chosen]]);
  const source=shape('record',fields);
  assert.equal(canBorrowStructural(source,want),true);
  assert.equal(canBorrowStructural(source,expect([field(fields[chosen].name,fields[chosen].type==='int'?'float':'int')])),false);
 }
});
