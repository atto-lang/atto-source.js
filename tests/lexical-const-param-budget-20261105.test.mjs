import test from 'node:test';
import assert from 'node:assert/strict';
import {LexicalConstScope,lower_const_sequence} from '../src/lexical-const-v0.mjs';

// Compiler-host lexical model checks only, not guest compiler execution.
test('128 parameters admitted exactly; 129 fail without aliasing',()=>{
 const names=Array.from({length:128},(_,i)=>'p'+i);
 const types=names.map(()=>'int');
 const root=LexicalConstScope.root(names,types);
 assert.equal(root.resolve('p127').index,127);
 assert.equal(root.resolve('p0').index,0);
 assert.throws(()=>LexicalConstScope.root([...names,'p128'],[...types,'int']),/invalid parameters/);
});
test('duplicate params denied; siblings cannot see each other or reuse allocated slots',()=>{
 assert.throws(()=>LexicalConstScope.root(['id','id'],['int','int']),/duplicate parameter/);
 const root=LexicalConstScope.root(['id'],['int']);
 const left=root.child(),right=root.child();
 const a=left.declare_const('value','int'),b=right.declare_const('value','int');
 assert.notEqual(a.slot,b.slot);
 assert.equal(left.resolve('value'),a);
 assert.equal(right.resolve('value'),b);
 assert.equal(root.resolve('value'),null);
});
test('declaration lowering requires a return continuation and preserves explicit fallback',()=>{
 const stmt={kind:'const',name:'value',type:'int',value:9};
 assert.deepEqual(lower_const_sequence([stmt],'value'),{
  kind:'localDecl',name:'value',type:'int',value:9,body:'value'
 });
 assert.throws(()=>lower_const_sequence([stmt]),/requires returning continuation/);
});