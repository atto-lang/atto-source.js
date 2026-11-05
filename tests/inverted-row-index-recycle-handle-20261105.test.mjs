import test from 'node:test';
import assert from 'node:assert/strict';
import {InvertedRowIndex} from '../src/inverted-row-index.mjs';

test('swap erasure compacts dense rows without invalidating displaced handles',()=>{
 const x=new InvertedRowIndex(),a=x.push(),b=x.push(),c=x.push();
 assert.equal(x.resolve(a),0);assert.equal(x.resolve(b),1);
 x.eraseSwap(b);
 assert.equal(x.size,2);assert.equal(x.resolve(c),1);
 assert.throws(()=>x.resolve(b),/stale inverted row handle/);
});
test('recycled slot generations cannot resurrect stale handles',()=>{
 const x=new InvertedRowIndex(),old=x.push();
 x.eraseSwap(old);const next=x.push();
 assert.equal(next.slot,old.slot);
 assert.notEqual(next.generation,old.generation);
 assert.equal(x.resolve(next),0);
 assert.throws(()=>x.resolve(old),/stale inverted row handle/);
});
test('foreign and accessor-forged handles never gain authority',()=>{
 const a=new InvertedRowIndex(),b=new InvertedRowIndex(),h=a.push();
 assert.throws(()=>b.resolve(h),/foreign or invalid inverted row handle/);
 assert.throws(()=>a.resolve({...h}),/foreign or invalid inverted row handle/);
 let reads=0;
 assert.throws(()=>a.resolve({get owner(){reads++;throw Error('getter');}}),
  /foreign or invalid inverted row handle/);
 assert.equal(reads,0);assert.equal(a.resolve(h),0);
});
test('integer-only indices and terminal close deny stale row reuse',()=>{
 const x=new InvertedRowIndex();x.push();
 assert.equal(x.resolve(x.index(0n)),0);
 for(const v of [-0,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])
  assert.throws(()=>x.index(v),/must be an integer/);
 for(const v of [-1,-1n,1,1n,2147483648n])
  assert.throws(()=>x.index(v),/outside current length/);
 x.close();assert.throws(()=>x.push(),/closed/);
});
