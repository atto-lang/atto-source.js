import test from 'node:test';
import assert from 'node:assert/strict';
import {installWorkerActorEndpoint} from '../src/worker-actor-endpoint.mjs';

const PROTOCOL='ores.js.worker.v1';
const moduleUrl=new URL('./fixtures/worker-handler.mjs',import.meta.url).href;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function harness(){
  let inbound;
  const frames=[];
  installWorkerActorEndpoint({subscribe:fn=>{inbound=fn;},post:frame=>frames.push(frame)});
  const init=()=>inbound({protocol:PROTOCOL,kind:'init',moduleUrl,
    exportName:'receive',mode:'handler',maxPending:2,maxPendingBytes:1024});
  return {send:frame=>inbound(frame),init,frames};
}
async function ready(h){
  h.init();
  for(let i=0;i<200&&!h.frames.some(f=>f.kind==='ready');i++)await sleep(2);
  assert.ok(h.frames.some(f=>f.kind==='ready'),'endpoint did not initialize');
}

for(const [field,next] of [
  ['protocol','kind'],['kind','id'],['id','reply'],['reply','value']
]){
  test('delivery revocation at '+field+' skips later '+next+' getter',async()=>{
    const h=harness();await ready(h);
    const frame={protocol:PROTOCOL,kind:'deliver',id:1,reply:true,
      value:{type:'add',x:40n,y:2n}};
    const admitted=frame[field];
    let reads=0,later=0;
    Object.defineProperty(frame,field,{get(){
      reads++;
      h.send({protocol:PROTOCOL,kind:'deliver',id:99,reply:true,value:1});
      return admitted;
    }});
    Object.defineProperty(frame,next,{get(){
      later++;
      throw Error('late getter executed');
    }});
    h.send(frame);
    assert.equal(reads,1);
    assert.equal(later,0,'terminal endpoint must not inspect later fields');
    assert.deepEqual(h.frames.map(f=>f.kind),['ready','fatal']);
    assert.match(h.frames.at(-1).error,/reentrant actor frame/);
    await sleep(15);
    assert.deepEqual(h.frames.map(f=>f.kind),['ready','fatal']);
  });
}

for(const [field,next] of [
  ['moduleUrl','exportName'],['exportName','mode'],
  ['mode','maxPending'],['maxPending','maxPendingBytes']
]){
  test('init revocation at '+field+' skips later '+next+' getter',async()=>{
    const h=harness();
    const frame={protocol:PROTOCOL,kind:'init',moduleUrl,
      exportName:'receive',mode:'handler',maxPending:2,maxPendingBytes:1024};
    const admitted=frame[field];
    let reads=0,later=0;
    Object.defineProperty(frame,field,{get(){
      reads++;
      h.init();
      return admitted;
    }});
    Object.defineProperty(frame,next,{get(){
      later++;
      throw Error('late init getter executed');
    }});
    h.send(frame);
    assert.equal(reads,1);
    assert.equal(later,0,'terminal endpoint must not inspect later init fields');
    assert.deepEqual(h.frames.map(f=>f.kind),['fatal']);
    assert.match(h.frames[0].error,/reentrant actor frame/);
    await sleep(15);
    assert.deepEqual(h.frames.map(f=>f.kind),['fatal']);
  });
}
