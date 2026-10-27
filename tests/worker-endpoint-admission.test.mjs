import test from 'node:test';
import assert from 'node:assert/strict';
import {installWorkerActorEndpoint} from '../src/worker-actor-endpoint.mjs';

const PROTOCOL='ores.js.worker.v1';
const MODULE_URL=new URL('./fixtures/worker-handler.mjs',import.meta.url).href;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function harness(){
  let listener;
  const frames=[];
  installWorkerActorEndpoint({
    subscribe(callback){listener=callback;},
    post(frame){frames.push(frame);}
  });
  const send=(kind,extra={})=>listener({protocol:PROTOCOL,kind,...extra});
  const raw=frame=>listener(frame);
  const init=(extra={})=>send('init',{
    moduleUrl:MODULE_URL,exportName:'receive',mode:'handler',
    maxPending:2,maxPendingBytes:32*1024*1024,...extra
  });
  const until=async(predicate,timeout=1000)=>{
    const deadline=Date.now()+timeout;
    while(!predicate()){
      if(Date.now()>deadline)assert.fail('Worker endpoint reply timed out');
      await sleep(2);
    }
  };
  return {frames,send,raw,init,until};
}

test('endpoint serializes deliveries with bounded in-flight credit and snapshots inbound bytes',async()=>{
  const h=harness();h.init();
  await h.until(()=>h.frames.some(f=>f.kind==='ready'));
  const source={type:'add',x:40n,y:2n};
  h.send('deliver',{id:1,reply:true,value:{type:'sleep',ms:35,n:1n}});
  h.send('deliver',{id:2,reply:true,value:source});
  source.x=999n;
  await h.until(()=>h.frames.filter(f=>f.kind==='result').length===2);
  assert.deepEqual(h.frames.filter(f=>f.kind==='result').map(f=>f.id),[1,2]);
  assert.deepEqual(h.frames.filter(f=>f.kind==='result').map(f=>f.value),[1n,42n]);
  assert.equal(h.frames.filter(f=>f.kind==='fatal').length,0);
});

test('in-flight capacity counts executing turn; overflow seals session and suppresses late replies',async()=>{
  const h=harness();h.init({maxPending:1});
  await h.until(()=>h.frames.some(f=>f.kind==='ready'));
  h.send('deliver',{id:1,reply:true,value:{type:'sleep',ms:45,n:1n}});
  h.send('deliver',{id:2,reply:true,value:{type:'add',x:20n,y:22n}});
  await h.until(()=>h.frames.some(f=>f.kind==='fatal'));
  assert.match(h.frames.find(f=>f.kind==='fatal').error,/capacity exceeded/);
  await sleep(65);
  assert.equal(h.frames.filter(f=>f.kind==='result').length,0);
  const prior=h.frames.length;
  h.send('deliver',{id:3,reply:true,value:{type:'add',x:1n,y:2n}});
  assert.equal(h.frames.length,prior);
});

test('duplicate and non-monotonic delivery IDs terminally fail protocol',async()=>{
  const h=harness();h.init();
  await h.until(()=>h.frames.some(f=>f.kind==='ready'));
  h.send('deliver',{id:2,reply:true,value:{type:'add',x:40n,y:2n}});
  await h.until(()=>h.frames.some(f=>f.kind==='result'));
  h.send('deliver',{id:2,reply:true,value:{type:'add',x:40n,y:2n}});
  await h.until(()=>h.frames.some(f=>f.kind==='fatal'));
  assert.match(h.frames.find(f=>f.kind==='fatal').error,/invalid or premature delivery/);
  assert.equal(h.frames.filter(f=>f.kind==='result').length,1);
});

test('malformed frames and wrong protocol trigger exactly one fatal event',()=>{
  const h=harness();
  h.raw({protocol:'wrong',kind:'init'});
  h.raw({protocol:PROTOCOL,kind:'init'});
  h.raw(null);
  assert.deepEqual(h.frames.map(f=>f.kind),['fatal']);
});

test('premature delivery fences asynchronous initialization and forbids ready',async()=>{
  const h=harness();
  h.init();
  h.send('deliver',{id:1,reply:true,value:{type:'add',x:40n,y:2n}});
  await h.until(()=>h.frames.some(f=>f.kind==='fatal'));
  await sleep(25);
  assert.deepEqual(h.frames.map(f=>f.kind),['fatal']);
});

test('duplicate initialization seals even a previously ready endpoint',async()=>{
  const h=harness();h.init();
  await h.until(()=>h.frames.some(f=>f.kind==='ready'));
  h.init();
  assert.deepEqual(h.frames.map(f=>f.kind),['ready','fatal']);
});

test('invalid maxPending and invalid delivery payload fail closed',async()=>{
  const bad=harness();bad.init({maxPending:0});
  assert.equal(bad.frames[0].kind,'fatal');
  const valid=harness();valid.init();
  await valid.until(()=>valid.frames.some(f=>f.kind==='ready'));
  if(typeof SharedArrayBuffer==='function'){
    valid.send('deliver',{id:1,reply:true,value:{
      type:'echo',payload:new Map([['shared',new Uint8Array(new SharedArrayBuffer(8))]])
    }});
    assert.equal(valid.frames.at(-1).kind,'fatal');
    assert.match(valid.frames.at(-1).error,/invalid actor delivery payload/);
  }else{
    valid.send('deliver',{id:1,reply:true,value:{type:'echo',payload:9}});
    await valid.until(()=>valid.frames.some(f=>f.kind==='result'));
  }
});

test('handler error reports a single failed result and leaves endpoint usable',async()=>{
  const h=harness();h.init();
  await h.until(()=>h.frames.some(f=>f.kind==='ready'));
  h.send('deliver',{id:1,reply:true,value:{type:'crash'}});
  await h.until(()=>h.frames.some(f=>f.kind==='result'));
  assert.equal(h.frames.find(f=>f.kind==='result').ok,false);
  assert.match(h.frames.find(f=>f.kind==='result').error,/intentional handler error/);
  h.send('deliver',{id:2,reply:true,value:{type:'add',x:40n,y:2n}});
  await h.until(()=>h.frames.filter(f=>f.kind==='result').length===2);
  assert.equal(h.frames.at(-1).value,42n);
});

test('pre-ready invalid frame makes late import completion inert',async()=>{
  const h=harness();
  h.raw({protocol:PROTOCOL,kind:'unexpected'});
  h.init();
  await sleep(20);
  assert.deepEqual(h.frames.map(f=>f.kind),['fatal']);
});

test('accessor-backed delivery snapshots kind, id and reply before queue admission',async()=>{
  const h=harness();h.init();
  await h.until(()=>h.frames.some(f=>f.kind==='ready'));
  const frame={protocol:PROTOCOL,value:{type:'add',x:40n,y:2n}};
  const reads={kind:0,id:0,reply:0};
  Object.defineProperty(frame,'kind',{get(){return ++reads.kind===1?'deliver':'unknown';}});
  Object.defineProperty(frame,'id',{get(){return ++reads.id===1?1:99;}});
  Object.defineProperty(frame,'reply',{get(){return ++reads.reply===1?true:false;}});
  h.raw(frame);
  assert.deepEqual(reads,{kind:1,id:1,reply:1});
  await h.until(()=>h.frames.some(f=>f.kind==='result'));
  assert.deepEqual(h.frames.at(-1),{protocol:PROTOCOL,kind:'result',id:1,ok:true,value:42n});
  h.send('deliver',{id:2,reply:true,value:{type:'add',x:20n,y:22n}});
  await h.until(()=>h.frames.filter(f=>f.kind==='result').length===2);
  assert.deepEqual(h.frames.filter(f=>f.kind==='result').map(f=>f.id),[1,2]);
  assert.equal(h.frames.filter(f=>f.kind==='fatal').length,0);
});

test('accessor-backed init pins validated module, export, mode and budgets',async()=>{
  const h=harness();
  const frame={protocol:PROTOCOL,kind:'init'};
  const reads={moduleUrl:0,exportName:0,mode:0,maxPending:0,maxPendingBytes:0};
  Object.defineProperty(frame,'moduleUrl',{get(){return ++reads.moduleUrl===1?MODULE_URL:'file:///not-the-validated-module.mjs';}});
  Object.defineProperty(frame,'exportName',{get(){return ++reads.exportName===1?'receive':'missing';}});
  Object.defineProperty(frame,'mode',{get(){return ++reads.mode===1?'handler':'call';}});
  Object.defineProperty(frame,'maxPending',{get(){return ++reads.maxPending===1?2:0;}});
  Object.defineProperty(frame,'maxPendingBytes',{get(){return ++reads.maxPendingBytes===1?1024:0;}});
  h.raw(frame);
  assert.deepEqual(reads,{moduleUrl:1,exportName:1,mode:1,maxPending:1,maxPendingBytes:1});
  await h.until(()=>h.frames.some(f=>f.kind==='ready'));
  h.send('deliver',{id:1,reply:true,value:{type:'add',x:40n,y:2n}});
  await h.until(()=>h.frames.some(f=>f.kind==='result'));
  assert.equal(h.frames.at(-1).value,42n);
  assert.equal(h.frames.filter(f=>f.kind==='fatal').length,0);
});

test('premature delivery does not inspect id/reply accessors',()=>{
  const h=harness();
  let idReads=0,replyReads=0;
  h.raw({protocol:PROTOCOL,kind:'deliver',
    get id(){idReads++;throw Error('id getter must not run');},
    get reply(){replyReads++;throw Error('reply getter must not run');}
  });
  assert.equal(idReads,0);
  assert.equal(replyReads,0);
  assert.deepEqual(h.frames.map(f=>f.kind),['fatal']);
  assert.match(h.frames[0].error,/invalid or premature delivery/);
});

test('invalid delivery id does not inspect reply accessor',async()=>{
  const h=harness();h.init();
  await h.until(()=>h.frames.some(f=>f.kind==='ready'));
  let replyReads=0;
  h.raw({protocol:PROTOCOL,kind:'deliver',id:0,
    get reply(){replyReads++;throw Error('reply getter must not run');}
  });
  assert.equal(replyReads,0);
  assert.deepEqual(h.frames.map(f=>f.kind),['ready','fatal']);
  assert.match(h.frames.at(-1).error,/invalid or premature delivery/);
});

test('reentrant endpoint kind getter terminally revokes without invoking nested guest work',async()=>{
  const h=harness();h.init();
  await h.until(()=>h.frames.some(f=>f.kind==='ready'));
  let reads=0;
  h.raw({
    protocol:PROTOCOL,id:1,reply:true,value:{type:'add',x:40n,y:2n},
    get kind(){
      reads++;
      h.send('deliver',{id:2,reply:true,value:{type:'add',x:20n,y:22n}});
      return 'deliver';
    }
  });
  assert.equal(reads,1);
  assert.deepEqual(h.frames.map(f=>f.kind),['ready','fatal']);
  assert.match(h.frames.at(-1).error,/reentrant actor frame/);
  await sleep(30);
  assert.equal(h.frames.filter(f=>f.kind==='result').length,0);
  h.send('deliver',{id:3,reply:true,value:{type:'add',x:1n,y:2n}});
  assert.deepEqual(h.frames.map(f=>f.kind),['ready','fatal']);
});

test('reentrant init descriptor cannot start import after fatal revocation',async()=>{
  const h=harness();
  h.raw({
    protocol:PROTOCOL,kind:'init',
    get moduleUrl(){h.init();return MODULE_URL;},
    exportName:'receive',mode:'handler',maxPending:2,maxPendingBytes:1024
  });
  assert.deepEqual(h.frames.map(f=>f.kind),['fatal']);
  assert.match(h.frames[0].error,/reentrant actor frame/);
  await sleep(25);
  assert.deepEqual(h.frames.map(f=>f.kind),['fatal']);
});

test('reentrant delivery value getter cannot resurrect mailbox credit after shutdown',async()=>{
  const h=harness();h.init();
  await h.until(()=>h.frames.some(f=>f.kind==='ready'));
  let valueReads=0;
  h.raw({
    protocol:PROTOCOL,kind:'deliver',id:1,reply:true,
    get value(){
      valueReads++;
      h.send('deliver',{id:2,reply:true,value:{type:'add',x:40n,y:2n}});
      return {type:'add',x:20n,y:22n};
    }
  });
  assert.equal(valueReads,1);
  assert.deepEqual(h.frames.map(f=>f.kind),['ready','fatal']);
  assert.match(h.frames.at(-1).error,/reentrant actor frame/);
  await sleep(30);
  assert.equal(h.frames.filter(f=>f.kind==='result').length,0);
});


test('reentrant value getter never runs post-revocation payload copy hooks',async()=>{
  const h=harness();h.init();
  await h.until(()=>h.frames.some(f=>f.kind==='ready'));
  let prototypeReads=0,valueReads=0;
  const payload=new Proxy({type:'add',x:40n,y:2n},{
    getPrototypeOf(target){
      prototypeReads++;
      return Reflect.getPrototypeOf(target);
    }
  });
  h.raw({
    protocol:PROTOCOL,kind:'deliver',id:1,reply:true,
    get value(){
      valueReads++;
      // Simulate an accessor-backed host transport invoking a nested frame.
      h.send('deliver',{id:2,reply:true,value:{type:'add',x:1n,y:2n}});
      return payload;
    }
  });
  assert.equal(valueReads,1);
  assert.equal(prototypeReads,0,'terminal revocation must prevent copy validation');
  assert.deepEqual(h.frames.map(f=>f.kind),['ready','fatal']);
  assert.match(h.frames.at(-1).error,/reentrant actor frame/);
  await sleep(20);
  assert.deepEqual(h.frames.map(f=>f.kind),['ready','fatal']);
});


function withPatchedIntrinsic(owner,name,replacement,action) {
  const original=Object.getOwnPropertyDescriptor(owner,name);
  assert.ok(original?.configurable,'host intrinsic must be restorable');
  Object.defineProperty(owner,name,{...original,value:replacement});
  try {return action();}
  finally {Object.defineProperty(owner,name,original);}
}

// A trusted guest module shares its Worker realm with the endpoint. It can
// modify Array/Object prototypes without possessing mailbox bookkeeping state.
// Such changes must not discard or rewrite admitted actor deliveries.
test('patched Array.push cannot silently discard an admitted delivery',async()=>{
  const h=harness();h.init();
  await h.until(()=>h.frames.some(f=>f.kind==='ready'));
  const original=Array.prototype.push;
  let intercepted=0;
  withPatchedIntrinsic(Array.prototype,'push',function(...items){
    if(items.length===1 && items[0]?.id===1 &&
       items[0]?.reply===true && Number.isSafeInteger(items[0]?.bytes)) {
      intercepted++;
      return this.length; // simulate a dropped queue insertion
    }
    return Reflect.apply(original,this,items);
  },()=>h.send('deliver',{id:1,reply:true,value:{type:'add',x:40n,y:2n}}));
  assert.equal(intercepted,0,'endpoint must use its captured queue push');
  await h.until(()=>h.frames.some(f=>f.kind==='result'));
  assert.equal(h.frames.at(-1).value,42n);
  assert.equal(h.frames.filter(f=>f.kind==='fatal').length,0);
});

test('patched Array.shift cannot substitute a different actor turn',async()=>{
  const h=harness();h.init();
  await h.until(()=>h.frames.some(f=>f.kind==='ready'));
  const original=Array.prototype.shift;
  let intercepted=0;
  withPatchedIntrinsic(Array.prototype,'shift',function(...args){
    if(this.length===1 && this[0]?.id===1 &&
       this[0]?.reply===true && Number.isSafeInteger(this[0]?.bytes)) {
      intercepted++;
      const forged={...this[0],value:{type:'add',x:1n,y:2n}};
      this.length=0;
      return forged;
    }
    return Reflect.apply(original,this,args);
  },()=>h.send('deliver',{id:1,reply:true,value:{type:'add',x:40n,y:2n}}));
  assert.equal(intercepted,0,'endpoint must use its captured queue shift');
  await h.until(()=>h.frames.some(f=>f.kind==='result'));
  assert.equal(h.frames.at(-1).value,42n);
  assert.equal(h.frames.filter(f=>f.kind==='fatal').length,0);
});

test('patched Object.freeze cannot replace a turn reply capability',async()=>{
  const h=harness();h.init();
  await h.until(()=>h.frames.some(f=>f.kind==='ready'));
  const original=Object.freeze;
  let intercepted=0;
  withPatchedIntrinsic(Object,'freeze',function(value){
    if(value && typeof value.respond==='function' && typeof value.done==='function') {
      intercepted++;
      return {respond(){},done(){}}; // forge a no-op turn authority
    }
    return Reflect.apply(original,Object,[value]);
  },()=>h.send('deliver',{id:1,reply:true,value:{type:'add',x:40n,y:2n}}));
  assert.equal(intercepted,0,'endpoint must use its captured turn freeze');
  await h.until(()=>h.frames.some(f=>f.kind==='result'));
  assert.equal(h.frames.at(-1).ok,true);
  assert.equal(h.frames.at(-1).value,42n);
  assert.equal(h.frames.filter(f=>f.kind==='fatal').length,0);
});

test('guest structuredClone replacement cannot alias a claimed reply before completion',async()=>{
  const h=harness();h.init();
  await h.until(()=>h.frames.some(f=>f.kind==='ready'));
  const original=globalThis.structuredClone;
  let intercepted=0;
  try{
    globalThis.structuredClone=value=>{intercepted++;return value;};
    h.send('deliver',{id:1,reply:true,value:{type:'reply-snapshot'}});
    await h.until(()=>h.frames.some(f=>f.kind==='result'));
    assert.deepEqual(h.frames.at(-1).value,{n:1},
      'reply must preserve value at self.respond, not later guest mutation');
    assert.equal(intercepted,0,'guest clone replacement must not run');
    assert.equal(h.frames.filter(f=>f.kind==='fatal').length,0);
  }finally{globalThis.structuredClone=original;}
});
