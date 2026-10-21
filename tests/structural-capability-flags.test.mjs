import test from 'node:test';
import assert from 'node:assert/strict';
import {canBorrowStructural,canAssignNominal} from '../src/structural-types.mjs';

const emptyView={kind:'record',fields:[],readOnly:true};

test('structural proof rejects non-boolean capability flags',()=>{
  assert.equal(canBorrowStructural({kind:'record',fields:[],actor:'true'},emptyView),false);
  assert.equal(canBorrowStructural({kind:'record',fields:[]},{...emptyView,mutable:'false'}),false);
  assert.equal(canBorrowStructural({kind:'record',fields:[]},{kind:'record',fields:[],readOnly:'true'}),false);
  assert.equal(canAssignNominal({kind:'record',fields:[],readOnly:'true'},{kind:'record',fields:[]}),false);
});

test('well-typed boolean flags retain existing semantics',()=>{
  assert.equal(canBorrowStructural({kind:'record',fields:[],actor:false},emptyView),true);
  assert.equal(canBorrowStructural({kind:'record',fields:[]},{...emptyView,mutable:false}),true);
});
