import test from 'node:test';
import assert from 'node:assert/strict';
import {createStructuralDomain} from '../src/structural-runtime.mjs';

test('structural runtime rejects contradictory carrier identity metadata',()=>{
  const d=createStructuralDomain();
  assert.throws(()=>d.defineType({kind:'record',name:'NamedRecord',fields:[]}),/unsupported typed scalar carrier/);
  assert.throws(()=>d.defineType({kind:'record',actor:'false',fields:[]}),/unsupported typed scalar carrier/);
  assert.throws(()=>d.defineType({kind:'record',actor:null,fields:[]}),/unsupported typed scalar carrier/);
  assert.doesNotThrow(()=>d.defineType({kind:'record',actor:false,fields:[]}));
});

test('empty methods metadata must use a canonical dense ordinary array',()=>{
  const d=createStructuralDomain();
  const strangeMethods=Object.setPrototypeOf([],null);
  assert.throws(()=>d.defineType({kind:'record',fields:[],methods:strangeMethods}),/untrusted array metadata/);
  const token=d.defineType({kind:'record',fields:[]});
  assert.throws(()=>d.compileView(token,{kind:'record',readOnly:true,fields:[],methods:strangeMethods}),/untrusted array metadata/);
  assert.doesNotThrow(()=>d.compileView(token,{kind:'record',readOnly:true,fields:[],methods:[]}));
});
