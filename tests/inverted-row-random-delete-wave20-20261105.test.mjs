import test from 'node:test';
import assert from 'node:assert/strict';
import {InvertedRowIndex} from '../src/inverted-row-index.mjs';

test('96 deterministic interior erase-swap operations retain dense and live physical rows',()=>{
  const rows=new InvertedRowIndex();
  for(let i=0;i<128;i++) rows.push();
  for(let turn=0;turn<96;turn++){
    const physical=(turn*37+11)%rows.size;
    const victim=rows.index(BigInt(physical));
    rows.eraseSwap(victim);
    assert.throws(()=>rows.resolve(victim),/stale inverted row handle/);
    assert.equal(rows.size,127-turn);
    for(let i=0;i<rows.size;i++)assert.equal(rows.resolve(rows.index(i)),i);
  }
  assert.equal(rows.size,32);
  rows.close();
});

test('generation increases monotonically through repeated recycling of one slot',()=>{
  const rows=new InvertedRowIndex();
  let old=rows.push();
  const initial=old.slot;
  for(let cycle=0;cycle<120;cycle++){
    rows.eraseSwap(old);
    const fresh=rows.push();
    assert.equal(fresh.slot,initial);
    assert.ok(fresh.generation>old.generation);
    assert.throws(()=>rows.resolve(old),/stale inverted row handle/);
    old=fresh;
  }
  rows.close();
});

test('public handle fields, copied tickets and cross-owner handles cannot grant authority',()=>{
  const left=new InvertedRowIndex(),right=new InvertedRowIndex();
  const a=left.push(),b=right.push();
  assert.equal(left.resolve(a),0);
  assert.equal(right.resolve(b),0);
  for(const forged of [{...a},{owner:a.owner,slot:a.slot,generation:a.generation},b]){
    assert.throws(()=>left.resolve(forged),/foreign or invalid inverted row handle/);
  }
  left.close();right.close();
});

test('numeric index admission never calls attacker conversion methods',()=>{
  const rows=new InvertedRowIndex(); rows.push();
  let calls=0;
  const hostile={valueOf(){calls++;throw Error('valueOf executed');},
    [Symbol.toPrimitive](){calls++;throw Error('coercion executed');}};
  for(const input of [hostile, new Number(0), -0, NaN, Infinity, -1, 0.2, 1n,
                       BigInt(Number.MAX_SAFE_INTEGER)+1n]){
    assert.throws(()=>rows.index(input));
  }
  assert.equal(calls,0);
  rows.close();
});
