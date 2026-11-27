import test from 'node:test';
import assert from 'node:assert/strict';
import {ReadonlyCopyDomain} from '../src/readonly-copy-domain.mjs';
const deny=(code,fn)=>assert.throws(fn,{code});
const make=(d,value=1,options={dynamic:true})=>{const o=d.create(options);d.initialize(o,'n',value);d.finish(o);return o;};
const pair=d=>{const a=make(d),ar=d.identity(a),c=make(d,10),child=d.identity(c);d.moveInto(a,ar,'child',c);return {a,ar,child};};
test('both field replacement directions, independent slots and immediate recovery',()=>{
  for(const original of [true,false]){
    const d=new ReadonlyCopyDomain(),{a,ar,child}=pair(d),b=d.copy(a),br=d.identity(b);
    deny('E_COPY_READONLY',()=>d.setScalar(a,child,'n',11));
    deny('E_COPY_READONLY',()=>d.setScalar(b,child,'n',11));
    d.setScalar(a,ar,'n',20);d.setScalar(b,br,'n',22);
    assert.equal(d.read(a,ar,'n')+d.read(b,br,'n'),42);
    const fresh=make(d,30),fr=d.identity(fresh);
    d.moveInto(original?a:b,original?ar:br,'child',fresh);
    deny('E_COPY_STALE',()=>d.identity(fresh));
    d.setScalar(original?a:b,fr,'n',31);
    d.setScalar(original?b:a,child,'n',12);
    assert.equal(d.read(original?b:a,child,'n'),12);
  }
});
test('third root and duplicate paths must both be detached',()=>{
  const d=new ReadonlyCopyDomain(),{a,ar,child}=pair(d);
  d.linkWithin(a,ar,'again',child);const b=d.copy(a),c=d.copy(b),br=d.identity(b);
  d.remove(b,br,'child');d.remove(b,br,'again');
  assert.equal(d.canWrite(a,child),false);d.drop(c);
  assert.equal(d.canWrite(a,child),true);
});
test('read loan blocks recovery after dropping other owner',()=>{
  const d=new ReadonlyCopyDomain(),{a,child}=pair(d),b=d.copy(a),l=d.readLoan(b,child);
  d.drop(b);deny('E_COPY_LOAN',()=>d.setScalar(a,child,'n',42));
  d.release(l);d.setScalar(a,child,'n',42);deny('E_COPY_STALE',()=>d.release(l));
});
test('source root back edges reject atomically; internal descendant cycles stay shared',()=>{
  const d=new ReadonlyCopyDomain(),a=make(d),ar=d.identity(a);
  d.linkWithin(a,ar,'self',ar);
  deny('E_COPY_SHALLOW_ALIAS',()=>d.copy(a));
  assert.equal(d.canWrite(a,ar),true);
  d.setScalar(a,ar,'n',2);
  d.remove(a,ar,'self');
  const c=make(d,20),cr=d.identity(c);
  d.moveInto(a,ar,'child',c);
  d.linkWithin(a,cr,'back',ar);
  deny('E_COPY_SHALLOW_ALIAS',()=>d.copy(a));
  assert.equal(d.canWrite(a,ar),true);
  assert.equal(d.canWrite(a,cr),true);
  d.remove(a,cr,'back');
  d.linkWithin(a,cr,'self',cr);
  const b=d.copy(a),br=d.identity(b);
  d.setScalar(a,ar,'n',20);d.setScalar(b,br,'n',22);
  assert.equal(d.read(a,ar,'n')+d.read(b,br,'n'),42);
  deny('E_COPY_READONLY',()=>d.setScalar(a,cr,'n',99));
  deny('E_COPY_READONLY',()=>d.setScalar(b,cr,'n',99));
  d.drop(b);d.setScalar(a,cr,'n',23);
  assert.equal(d.read(a,cr,'n'),23);
});
test('failed move retains donor and original slot, readonly and foreign denial',()=>{
  const d=new ReadonlyCopyDomain({maxWork:5}),a=make(d),ar=d.identity(a),fresh=d.create({dynamic:true});
  d.initialize(fresh,'a',1);d.initialize(fresh,'b',2);d.initialize(fresh,'c',3);d.finish(fresh);
  deny('E_COPY_BUDGET',()=>d.moveInto(a,ar,'n',fresh));
  assert.equal(d.read(a,ar,'n'),1);assert.ok(d.identity(fresh));
  const fixed=d.create();d.initialize(fixed,'x',1,false);d.finish(fixed);
  deny('E_COPY_READONLY_SLOT',()=>d.moveInto(fixed,d.identity(fixed),'x',fresh));
  const foreign=new ReadonlyCopyDomain(),f=make(foreign);
  deny('E_COPY_STALE',()=>d.moveInto(a,ar,'n',f));
  deny('E_COPY_TYPE',()=>d.setScalar(a,ar,'n',{}));
});
test('noncopyable descendants fail closed without partial retention',()=>{
  const d=new ReadonlyCopyDomain(),a=make(d),ar=d.identity(a),c=make(d,2,{noncopyable:true}),cr=d.identity(c);
  d.moveInto(a,ar,'child',c);deny('E_COPY_FORBIDDEN',()=>d.copy(a));
  d.setScalar(a,cr,'n',3);assert.equal(d.read(a,cr,'n'),3);
});
test('bounded root and read-loan capacity, scalar fast path',()=>{
  const d=new ReadonlyCopyDomain({maxRoots:2,maxLoans:1,maxWork:2}),a=make(d),ar=d.identity(a),b=d.copy(a);
  deny('E_COPY_BUDGET',()=>d.copy(a));
  const l=d.readLoan(a,ar);deny('E_COPY_BUDGET',()=>d.readLoan(a,ar));
  d.release(l);for(let i=0;i<10000;i++)d.setScalar(a,ar,'n',i);
  assert.equal(d.read(a,ar,'n'),9999);assert.equal(d.read(b,d.identity(b),'n'),1);
});
test('rejected cycles do not consume root quota or change holder counts',()=>{
  const d=new ReadonlyCopyDomain({maxRoots:2}),a=make(d),ar=d.identity(a);
  d.linkWithin(a,ar,'self',ar);
  for(let i=0;i<1000;i++)deny('E_COPY_SHALLOW_ALIAS',()=>d.copy(a));
  assert.equal(d.canWrite(a,ar),true);
  d.remove(a,ar,'self');
  const b=d.copy(a);deny('E_COPY_BUDGET',()=>d.copy(a));
  d.drop(b);d.setScalar(a,ar,'n',42);
  assert.equal(d.read(a,ar,'n'),42);
});
test('unpublished roots cannot acquire read loans or consume loan capacity',()=>{
  const d=new ReadonlyCopyDomain({maxLoans:1}),a=d.create(),ar=d.identity(a);
  d.initialize(a,'n',1);
  for(let i=0;i<1000;i++)deny('E_COPY_LAYOUT',()=>d.readLoan(a,ar));
  assert.equal(d.canWrite(a,ar),true);
  d.finish(a);
  const l=d.readLoan(a,ar);
  deny('E_COPY_LOAN',()=>d.setScalar(a,ar,'n',2));
  d.release(l);d.setScalar(a,ar,'n',42);
  assert.equal(d.read(a,ar,'n'),42);
});
test('read loan survives detachment of both outer roots and owner retirement',()=>{
  const d=new ReadonlyCopyDomain(),{a,ar,child}=pair(d),b=d.copy(a),br=d.identity(b);
  const l=d.readLoan(b,child);
  d.remove(a,ar,'child');
  assert.equal(d.canWrite(b,child),false);
  deny('E_COPY_LOAN',()=>d.setScalar(b,child,'n',99));
  d.remove(b,br,'child');d.drop(a);d.drop(b);
  d.release(l);deny('E_COPY_STALE',()=>d.release(l));
});

test('copy during a source-root read loan creates writable outer slots only',()=>{
  const d=new ReadonlyCopyDomain(),{a,ar,child}=pair(d),l=d.readLoan(a,ar);
  const b=d.copy(a),br=d.identity(b);
  assert.notEqual(ar,br);
  deny('E_COPY_LOAN',()=>d.setScalar(a,ar,'n',20));
  d.setScalar(b,br,'n',22);
  deny('E_COPY_READONLY',()=>d.setScalar(b,child,'n',99));
  d.remove(b,br,'child');
  deny('E_COPY_LOAN',()=>d.setScalar(a,child,'n',99));
  d.release(l);
  d.setScalar(a,ar,'n',20);d.setScalar(a,child,'n',42);
  assert.equal(d.read(a,ar,'n')+d.read(b,br,'n'),42);
  assert.equal(d.read(a,child,'n'),42);
});
test('overlapping loans release independently across successive copies',()=>{
  const d=new ReadonlyCopyDomain(),{a,ar,child}=pair(d),b=d.copy(a),c=d.copy(b);
  const l1=d.readLoan(b,child),l2=d.readLoan(c,child);
  d.drop(b);d.drop(c);
  d.release(l1);deny('E_COPY_LOAN',()=>d.setScalar(a,child,'n',99));
  deny('E_COPY_STALE',()=>d.release(l1));
  d.release(l2);d.setScalar(a,child,'n',42);
  assert.equal(d.read(a,ar,'child'),child);
  assert.equal(d.read(a,child,'n'),42);
});
test('shallow copy retains fixed slot mutability and isolates writable slots',()=>{
  const d=new ReadonlyCopyDomain(),a=d.create();
  d.initialize(a,'fixed',7,false);d.initialize(a,'n',1);d.finish(a);
  const ar=d.identity(a),b=d.copy(a),br=d.identity(b);
  for(const [owner,id] of [[a,ar],[b,br]]){
    deny('E_COPY_READONLY_SLOT',()=>d.setScalar(owner,id,'fixed',99));
    deny('E_COPY_READONLY_SLOT',()=>d.remove(owner,id,'fixed'));
    deny('E_COPY_LAYOUT',()=>d.setScalar(owner,id,'extra',99));
    assert.equal(d.read(owner,id,'fixed'),7);
  }
  d.setScalar(a,ar,'n',20);d.setScalar(b,br,'n',22);
  assert.equal(d.read(a,ar,'n')+d.read(b,br,'n'),42);
});
