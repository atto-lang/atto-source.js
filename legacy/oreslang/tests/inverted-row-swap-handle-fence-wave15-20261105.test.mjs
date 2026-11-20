import test from 'node:test';
import assert from 'node:assert/strict';
import {InvertedRowIndex} from '../src/inverted-row-index.mjs';

test('eraseSwap relocates only the last row while surviving handles stay live',()=>{
  const index=new InvertedRowIndex();
  const a=index.push(),b=index.push(),c=index.push();
  assert.equal(index.resolve(a),0);
  assert.equal(index.resolve(b),1);
  assert.equal(index.resolve(c),2);
  index.eraseSwap(b);
  assert.equal(index.size,2);
  assert.equal(index.resolve(a),0);
  assert.equal(index.resolve(c),1);
  assert.throws(()=>index.resolve(b),/stale inverted row handle/);
  assert.equal(index.resolve(index.index(1n)),1);
});

test('slot recycling advances generation and rejects forged or foreign tickets',()=>{
  const index=new InvertedRowIndex(),foreign=new InvertedRowIndex();
  const old=index.push();
  index.eraseSwap(old);
  const fresh=index.push();
  assert.equal(fresh.slot,old.slot);
  assert.ok(fresh.generation>old.generation);
  assert.throws(()=>index.resolve(old),/stale inverted row handle/);
  assert.throws(()=>index.resolve({...fresh}),/foreign or invalid inverted row handle/);
  assert.throws(()=>foreign.resolve(fresh),/foreign or invalid inverted row handle/);
  assert.equal(index.resolve(fresh),0);
});

test('index admission rejects negative zero, fractional and out-of-range values',()=>{
  const index=new InvertedRowIndex();
  const ticket=index.push();
  assert.throws(()=>index.index(-0),/must be an integer/);
  assert.throws(()=>index.index(0.5),/must be an integer/);
  assert.throws(()=>index.index(1n),/outside current length/);
  index.close();
  index.close();
  assert.throws(()=>index.resolve(ticket),/index is closed/);
  assert.throws(()=>index.push(),/index is closed/);
});
