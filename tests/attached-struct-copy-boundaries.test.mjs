import test from 'node:test';
import assert from 'node:assert/strict';
import {compileAttachedStruct} from '../src/attached-struct-v1.mjs';

const prefix='define struct Point { int x; int y; } with { constructor(int x,int y){self.x=x;self.y=y;} mut mtd void • set(int x){self.x=x;} mtd int • sum(){return self.x+self.y;} } ';
const guest=body=>prefix+'pub fnc main():int { '+body+' }';
const run=async source=>{
  const esm=compileAttachedStruct(source);
  assert.equal(compileAttachedStruct(source),esm);
  return (await import('data:text/javascript,'+encodeURIComponent(esm))).main();
};

test('attached struct copies are independent in both mutation directions',async()=>{
  for(const body of [
    'let mut a=Point(40,2); let b=copy! a; a.set(1); return b.sum();',
    'let a=Point(40,2); let mut b=copy! a; b.set(1); return a.sum();',
    'let mut a=Point(40,2); let b=a; a.set(1); return b.sum();'
  ])assert.equal(await run(guest(body)),42n);
  const nested=prefix+'define struct Boxed { Point p; } with { constructor(Point p){self.p=p;} mtd int • get(){return self.p.x+self.p.y;} mut mtd void • change(int x){self.p.x=x;} } pub fnc main():int {let mut a=Point(40,2); let mut b=Boxed(a); let c=copy! b; a.set(1); b.change(2); return c.get();}';
  assert.equal(await run(nested),42n);
});

test('signed i64 endpoints survive attached struct constructor and accessor',async()=>{
  assert.equal(await run(guest('let a=Point(-9223372036854775808,0); return a.sum();')),-9223372036854775808n);
  assert.equal(await run(guest('let a=Point(9223372036854775807,0); return a.sum();')),9223372036854775807n);
});

test('attached struct overflow is a runtime error, never a compile rejection',async()=>{
  for(const body of [
    'let a=Point(9223372036854775807,1); return a.sum();',
    'let a=Point(-9223372036854775808,-1); return a.sum();',
    'let a=Point(9223372036854775807+1,0); return a.sum();'
  ]){
    const source=guest(body);
    const esm=compileAttachedStruct(source);
    assert.equal(compileAttachedStruct(source),esm);
    const compiled=await import('data:text/javascript,'+encodeURIComponent(esm));
    assert.throws(()=>compiled.main(),e=>e instanceof RangeError&&e.message==='E_OVERFLOW');
  }
});

test('invalid copy and mutation rejected before code generation',()=>{
  for(const body of [
    'let mut a=Point(40,2); a.set(true); return a.sum();',
    'let a=copy! missing; return 42;',
    'let a=Point(40,2); let b=copy! a; b.set(1); return a.sum();'
  ])assert.throws(()=>compileAttachedStruct(guest(body)),/E_ATTACHED_STRUCT/);
});
