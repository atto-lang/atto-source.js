// Host reference regression; this does not execute an AttoLang guest.
import test from 'node:test';
import assert from 'node:assert/strict';
import {InvertedRowIndex} from '../src/inverted-row-index.mjs';

test('repeated interior swap-deletes keep every issued live row mapping dense',()=>{
  const rows=new InvertedRowIndex();
  const old=Array.from({length:24},()=>rows.push());
  assert.equal(rows.size,24);
  for(let turn=0;turn<20;turn++){
    const victim=rows.index(BigInt((turn*7)%rows.size));
    const before=rows.size;
    rows.eraseSwap(victim);
    assert.equal(rows.size,before-1);
    assert.throws(()=>rows.resolve(victim),/stale inverted row handle/);
    for(let i=0;i<rows.size;i++)assert.equal(rows.resolve(rows.index(BigInt(i))),i);
  }
  const stillLive=old.filter(h=>{try{rows.resolve(h);return true}catch{return false}});
  assert.equal(stillLive.length,4);
  rows.close();
  assert.throws(()=>rows.size,/closed/);
  for(const h of stillLive)assert.throws(()=>rows.resolve(h),/closed/);
});

test('copied and forged public handle fields never grant slot authority',()=>{
  const first=new InvertedRowIndex(),second=new InvertedRowIndex();
  const a=first.push(),b=second.push();
  const copy={...a};
  assert.equal(first.resolve(a),0);
  assert.equal(second.resolve(b),0);
  assert.throws(()=>first.resolve(copy),/foreign or invalid/);
  assert.throws(()=>second.resolve(a),/foreign or invalid/);
  assert.throws(()=>first.resolve(Object.freeze({owner:a.owner,slot:a.slot,generation:a.generation})),/foreign or invalid/);
  first.eraseSwap(a);
  const successor=first.push();
  assert.equal(first.resolve(successor),0);
  assert.throws(()=>first.resolve(a),/stale/);
  second.close();first.close();
});

test('numeric index input is exact and never coerces hostile objects',()=>{
  const r=new InvertedRowIndex();r.push();r.push();
  assert.equal(r.resolve(r.index(0n)),0);
  assert.equal(r.resolve(r.index(1)),1);
  let invoked=0;
  const hostile={valueOf(){invoked++;throw Error('unsafe coercion');}};
  for(const value of [hostile,new Number(0),NaN,Infinity,-0,-1,0.5,2,2n,
                       BigInt(Number.MAX_SAFE_INTEGER)+1n])
    assert.throws(()=>r.index(value));
  assert.equal(invoked,0);
  r.close();
  assert.throws(()=>r.push(),/closed/);
});
