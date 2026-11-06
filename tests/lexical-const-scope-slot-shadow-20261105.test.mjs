import test from 'node:test';
import assert from 'node:assert/strict';
import {LexicalConstScope,lower_const_sequence} from '../src/lexical-const-v0.mjs';

test('lexical scopes share slot allocation but never leak local lookup into parents',()=>{
 const root=LexicalConstScope.root(['arg','flag'],['int','bool']);
 const a=root.declare_const('first','int'),child=root.child();
 const b=child.declare_const('second','symbol');
 const sibling=root.child(),c=sibling.declare_const('third','bool');
 assert.deepEqual([a.slot,b.slot,c.slot],[0,1,2]);
 assert.equal(child.resolve('arg').index,0);
 assert.equal(child.resolve('first'),a);
 assert.strictEqual(root.resolve('second'),null);
 assert.strictEqual(sibling.resolve('second'),null);
 assert.strictEqual(root.resolve('flag').type,'bool');
});

test('inherited shadowing, invalid types and forged allocator/depth cannot bypass scope fences',()=>{
 const root=LexicalConstScope.root(['input'],['int']);
 assert.throws(()=>root.child().declare_const('input','int'),/shadows/);
 assert.throws(()=>root.declare_const('constructor','int'),/invalid or reserved/);
 assert.throws(()=>root.declare_const('newval','unknown'),/unsupported binding type/);
 assert.throws(()=>new LexicalConstScope(null,0),/override forbidden/);
 let scope=root;
 for(let i=0;i<192;i++)scope=scope.child();
 assert.throws(()=>scope.child(),/depth budget exceeded/);
});

test('parameter descriptors and lexical statement slots do not execute accessors',()=>{
 let getterCalls=0;
 const args=['safe'];
 Object.defineProperty(args,'0',{enumerable:true,configurable:true,get(){getterCalls++;throw Error('untrusted getter');}});
 assert.throws(()=>LexicalConstScope.root(args,['int']),/invalid parameter descriptors/);
 const statements=[{kind:'return',value:42}];
 Object.defineProperty(statements,'0',{enumerable:true,configurable:true,get(){getterCalls++;throw Error('untrusted getter');}});
 assert.throws(()=>lower_const_sequence(statements),/invalid lexical statement slot/);
 assert.equal(getterCalls,0);
 const ir=lower_const_sequence([{kind:'const',name:'answer',type:'int',value:42},{kind:'return',value:'answer'}]);
 assert.equal(ir.kind,'localDecl');
 assert.equal(ir.body,'answer');
});
