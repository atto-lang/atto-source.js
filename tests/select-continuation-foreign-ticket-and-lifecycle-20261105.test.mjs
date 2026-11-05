import test from 'node:test';
import assert from 'node:assert/strict';
import {SelectContinuationFence} from '../src/select-continuation-fence.mjs';

test('bounded ticket identity is single-consume across slot reuse',()=>{
 const f=new SelectContinuationFence({generation:7,maxTickets:2});
 const a=f.register(),b=f.register();
 assert.throws(()=>f.register(),/capacity exhausted/);
 assert.equal(f.tryConsume(a),true);
 assert.equal(f.tryConsume(a),false);
 const c=f.register();
 assert.equal(f.tryConsume(a),false);
 assert.equal(c.active,true);
 assert.equal(b.close(),true);
 assert.equal(f.tryConsume(c),true);
 assert.equal(f.pendingTickets,0);
});
test('foreign or fabricated tickets cannot enter a different actor lane',()=>{
 const a=new SelectContinuationFence(),b=new SelectContinuationFence();
 const ticket=a.register();
 assert.equal(b.tryConsume(ticket),false);
 assert.equal(a.tryConsume(Object.freeze({owner:a,index:0,id:1,generation:1})),false);
 assert.equal(a.tryConsume(ticket),true);
});
test('generation change and terminal shutdown fence stale resumptions',()=>{
 const f=new SelectContinuationFence({generation:3});
 const ticket=f.register();
 assert.equal(f.advance(2),false);
 assert.equal(f.advance(3),true);
 assert.equal(f.tryConsume(ticket),false);
 assert.throws(()=>f.register(3),/stale actor generation/);
 const next=f.register();
 assert.equal(f.close(),true);
 assert.equal(f.close(),false);
 assert.equal(next.active,false);
 assert.equal(f.advance(4),false);
 assert.throws(()=>f.register(),/fence is closed/);
});
test('options with accessor authority are rejected without invocation',()=>{
 let hits=0;const hostile={};
 Object.defineProperty(hostile,'generation',{enumerable:true,get(){hits++;return 1;}});
 assert.throws(()=>new SelectContinuationFence(hostile),/own data fields/);
 assert.equal(hits,0);
 assert.throws(()=>new SelectContinuationFence({[Symbol('authority')]:true}),/unknown continuation option/);
});