import test from 'node:test';
import assert from 'node:assert/strict';
import {InvertedRowIndex} from '../src/inverted-row-index.mjs';

test('eraseSwap rehomes the final live row without invalidating its opaque handle',()=>{
 const rows=new InvertedRowIndex();
 const first=rows.push(), middle=rows.push(), last=rows.push();
 assert.deepEqual([rows.resolve(first),rows.resolve(middle),rows.resolve(last)],[0,1,2]);
 rows.eraseSwap(first);
 assert.equal(rows.size,2);
 assert.equal(rows.resolve(last),0);
 assert.equal(rows.resolve(middle),1);
 assert.equal(rows.resolve(rows.index(0n)),0);
 assert.throws(()=>rows.resolve(first),/stale inverted row handle/);
 const recycled=rows.push();
 assert.equal(recycled.slot,first.slot);
 assert.notEqual(recycled.generation,first.generation);
 assert.equal(rows.resolve(recycled),2);
 assert.throws(()=>rows.eraseSwap(first),/stale inverted row handle/);
});

test('opaque issuance and per-index owner prohibit fabricated or cross-instance rows',()=>{
 const a=new InvertedRowIndex(),b=new InvertedRowIndex();
 const issued=a.push(),foreign=b.push();
 assert.throws(()=>b.resolve(issued),/foreign or invalid inverted row handle/);
 assert.throws(()=>a.resolve(foreign),/foreign or invalid inverted row handle/);
 assert.throws(()=>a.resolve(Object.freeze({...issued})),/foreign or invalid inverted row handle/);
 assert.throws(()=>a.resolve(Object.create(issued)),/foreign or invalid inverted row handle/);
 assert.equal(a.resolve(a.index(0)),0);
});

test('index admission rejects lossy numeric authority and close revokes all row access',()=>{
 const rows=new InvertedRowIndex(),h=rows.push();
 for(const value of [-0,0.25,Infinity,NaN,'0',Number.MAX_SAFE_INTEGER+1])
   assert.throws(()=>rows.index(value),/inverted row index must be an integer/);
 for(const value of [-1,1,1n,2147483648n])
   assert.throws(()=>rows.index(value),/inverted row index outside current length/);
 rows.close();rows.close();
 for(const f of [()=>rows.size,()=>rows.resolve(h),()=>rows.push(),()=>rows.index(0)])
   assert.throws(f,/inverted row index is closed/);
});
