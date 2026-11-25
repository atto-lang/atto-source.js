import test from 'node:test';
import assert from 'node:assert/strict';
import {LexicalConstScope,LexicalConstError,lower_const_sequence} from '../src/lexical-const-v0.mjs';

test('immutable locals are scoped, distinct, and never shadow parameters',()=>{
  const root=LexicalConstScope.root(['input'],['int']);
  const a=root.child(),b=root.child();
  assert.deepEqual(root.resolve('input'),{kind:'param',index:0,name:'input',type:'int'});
  assert.deepEqual(a.declare_const('first','int'),{kind:'local',slot:0,name:'first',type:'int'});
  assert.deepEqual(b.declare_const('second','bool'),{kind:'local',slot:1,name:'second',type:'bool'});
  assert.equal(a.resolve('second'),null);
  assert.equal(b.resolve('first'),null);
  assert.equal(root.resolve('first'),null);
  assert.throws(()=>a.declare_const('input','int'),LexicalConstError);
  assert.throws(()=>a.declare_const('first','int'),LexicalConstError);
  assert.equal(Object.isFrozen(a.resolve('first')),true);
});

test('lexical children inherit types without leaking their bindings',()=>{
  const root=LexicalConstScope.root([],[]);
  root.declare_const('outer','symbol');
  const child=root.child();
  assert.deepEqual(child.resolve('outer'),root.resolve('outer'));
  child.declare_const('inner','option<int>');
  assert.equal(root.resolve('inner'),null);
  assert.throws(()=>child.declare_const('outer','int'),/shadows/);
});

test('reject reserved names, invalid metadata and nesting over budget',()=>{
  for(const name of ['self','return','const','Option','1x','foo-bar',''])
    assert.throws(()=>LexicalConstScope.root([name],['int']),LexicalConstError);
  for(const type of ['float','void','Pointer','Int',42])
    assert.throws(()=>LexicalConstScope.root(['x'],[type]),LexicalConstError);
  assert.throws(()=>LexicalConstScope.root(['x'],[]),LexicalConstError);
  assert.throws(()=>LexicalConstScope.root(['x','x'],['int','bool']),/duplicate/);
  let scope=LexicalConstScope.root([],[]);
  for(let i=0;i<192;i++)scope=scope.child();
  assert.throws(()=>scope.child(),/depth budget/);
});

test('lower sequence preserves lexical initializer order and return',()=>{
  const init={kind:'int',value:'41'};
  const body={kind:'binary',op:'+',left:{kind:'variable',name:'x'},right:{kind:'int',value:'1'}};
  const lowered=lower_const_sequence([
    {kind:'const',name:'x',type:'int',value:init},
    {kind:'return',value:body}
  ]);
  assert.deepEqual(lowered,{kind:'localDecl',name:'x',type:'int',value:init,body});
});

test('fail closed for unsupported and malformed statement sequences',()=>{
  for(const seq of [[],[{kind:'const',name:'x',type:'int',value:1}],
    [{kind:'return',value:1},{kind:'return',value:2}],
    [{kind:'let',name:'x',value:1},{kind:'return',value:1}],
    [{kind:'return',value:1,host:'escape'}],
    [{kind:'const',name:'__proto__',type:'int',value:1},{kind:'return',value:2}]
  ]) assert.throws(()=>lower_const_sequence(seq),LexicalConstError);
});


test('constructor cannot reset slot allocator, inject negative slots, or bypass depth',()=>{
  const root=LexicalConstScope.root(['argument'],['int']);
  for(const args of [
    [null,{next:-1},0],
    [root,{next:0},0],
    [root,{next:999999},-100],
    [root,null,0]
  ]) assert.throws(()=>new LexicalConstScope(...args),/allocator\/depth override forbidden/);
  assert.throws(()=>new LexicalConstScope({}),/invalid scope parent/);
  const first=root.child().declare_const('first','int');
  const second=new LexicalConstScope(root).declare_const('second','int');
  assert.equal(first.slot,0);
  assert.equal(second.slot,1);
  let nested=root;
  for(let i=0;i<192;i++)nested=new LexicalConstScope(nested);
  assert.throws(()=>new LexicalConstScope(nested),/depth budget exceeded/);
});

test('root scopes isolate slot allocators and preserve binding inheritance',()=>{
  const left=LexicalConstScope.root([],[]);
  const right=LexicalConstScope.root([],[]);
  assert.equal(left.declare_const('a','int').slot,0);
  assert.equal(right.declare_const('b','int').slot,0);
  assert.equal(left.child().declare_const('c','bool').slot,1);
  assert.equal(right.resolve('a'),null);
  assert.equal(left.resolve('b'),null);
});


test('parent must carry genuine private brand; forged prototypes cannot steal depth',()=>{
  const imposter=Object.create(LexicalConstScope.prototype);
  assert.throws(()=>new LexicalConstScope(imposter),/invalid scope parent/);
  assert.throws(()=>LexicalConstScope.prototype.child.call(imposter),/invalid scope parent/);
});

test('local shadowing gate is immune to overridden public resolver',()=>{
  const root=LexicalConstScope.root(['owner'],['int']);
  const child=root.child();
  child.resolve=()=>null;
  assert.throws(()=>child.declare_const('owner','int'),/shadows/);
  root.resolve=()=>null;
  assert.throws(()=>child.declare_const('owner','int'),/shadows/);
});


test('nested declaration lowering fails before producing overdeep IR candidates',()=>{
  const make=length=>[
    ...Array.from({length},(_,i)=>({kind:'const',name:'c'+i,type:'int',value:{kind:'int',value:'1'}})),
    {kind:'return',value:{kind:'int',value:'2'}}
  ];
  const within=lower_const_sequence(make(192));
  assert.equal(within.kind,'localDecl');
  assert.throws(()=>lower_const_sequence(make(193)),/nested const depth budget exceeded/);
});

test('parameter metadata getters are rejected without execution or slot allocation',()=>{
  let calls=0;
  const names=['safe'];
  Object.defineProperty(names,'0',{enumerable:true,get(){calls++;return 'unsafe';}});
  assert.throws(()=>LexicalConstScope.root(names,['int']),/invalid parameter descriptors/);
  assert.equal(calls,0);
  const types=['int'];
  Object.defineProperty(types,'0',{enumerable:true,get(){calls++;return 'int';}});
  assert.throws(()=>LexicalConstScope.root(['safe'],types),/invalid parameter descriptors/);
  assert.equal(calls,0);
  assert.throws(()=>LexicalConstScope.root(new Array(1),['int']),/invalid parameter descriptors/);
  assert.throws(()=>LexicalConstScope.root(['safe'],new Array(1)),/invalid parameter descriptors/);
  const root=LexicalConstScope.root(['safe'],['int']);
  assert.equal(root.child().declare_const('next','int').slot,0);
});

test('lexical statement sequence refuses accessor and sparse array slots without calling them',()=>{
  let calls=0;
  const accessor=[{kind:'return',value:{kind:'int',value:'1'}}];
  Object.defineProperty(accessor,'0',{enumerable:true,get(){
    calls++;return {kind:'return',value:{kind:'int',value:'2'}};
  }});
  assert.throws(()=>lower_const_sequence(accessor),/invalid lexical statement slot/);
  assert.equal(calls,0);
  assert.throws(()=>lower_const_sequence(new Array(1)),/invalid lexical statement slot/);
  assert.deepEqual(lower_const_sequence([{kind:'return',value:42}]),42);
});

test('statement proxies cannot replace validated descriptor values via get traps',()=>{
  let reads=0;
  const item=new Proxy({kind:'return',value:42},{
    get(){reads++;throw Error('unsafe caller get trap');},
    getPrototypeOf(){return Object.prototype;},
    ownKeys(target){return Reflect.ownKeys(target);},
    getOwnPropertyDescriptor(target,key){return Object.getOwnPropertyDescriptor(target,key);}
  });
  assert.equal(lower_const_sequence([item]),42);
  assert.equal(reads,0,'validated fields must not be reread');
  const mutating=new Proxy({kind:'const',name:'safe',type:'int',value:7},{
    get(){reads++;return 'forged';},
    getPrototypeOf(){return Object.prototype;},
    ownKeys(target){return Reflect.ownKeys(target);},
    getOwnPropertyDescriptor(target,key){return Object.getOwnPropertyDescriptor(target,key);}
  });
  assert.deepEqual(lower_const_sequence([mutating,{kind:'return',value:42}]),
    {kind:'localDecl',name:'safe',type:'int',value:7,body:42});
  assert.equal(reads,0);
});

test('array proxies cannot change parameter or statement count through length get traps',()=>{
  let reads=0;
  const noLengthGet=values=>new Proxy(values,{
    get(target,key,receiver){
      if(key==='length'){reads++;throw Error('hostile length getter');}
      return Reflect.get(target,key,receiver);
    }
  });
  const root=LexicalConstScope.root(noLengthGet(['arg']),noLengthGet(['int']));
  assert.deepEqual(root.resolve('arg'),{kind:'param',index:0,name:'arg',type:'int'});
  assert.equal(lower_const_sequence(noLengthGet([{kind:'return',value:42}])),42);
  assert.equal(reads,0,'array lengths must come from admitted own descriptors');
  assert.throws(()=>LexicalConstScope.root(noLengthGet(['arg']),noLengthGet([])),/invalid parameters/);
});
