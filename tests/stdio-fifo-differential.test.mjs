import assert from 'node:assert/strict';
import { BufferedStdioHost } from '../src/buffered-stdio-host.mjs';
let seed=0x4a7e19e5; const rand=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
let operations=0, acceptedTotal=0, cancelledTotal=0, deniedTotal=0;
for(let batch=0;batch<128;batch++){
  let release; const hold=new Promise(r=>release=r), delivered=[];
  const maxRecords=8,maxBytes=24,maxWaiters=6,maxPendingBytes=24;
  const q=new BufferedStdioHost(async text=>{await hold;delivered.push(text)},maxRecords,maxBytes,maxWaiters,maxPendingBytes);
  const accepted=[],waiting=[],all=[];
  const sum=xs=>xs.reduce((n,x)=>n+x.bytes,0);
  const fits=e=>accepted.length<maxRecords&&sum(accepted)+e.bytes<=maxBytes;
  const promote=()=>{while(waiting.length&&fits(waiting[0])){const e=waiting.shift();e.admit='OK';e.delivery='OK';accepted.push(e);acceptedTotal++;}};
  for(let i=0;i<128;i++){
    if(all.length&&rand()%4===0){const e=all[rand()%all.length];const index=waiting.indexOf(e);assert.equal(e.h.cancel(),index>=0);if(index>=0){waiting.splice(index,1);e.admit=e.delivery='CANCELLED';cancelledTotal++;promote();}}
    else{
      const bytes=rand()%30;const str='x'.repeat(bytes);const e={bytes,str,h:q.admit(str),admit:null,delivery:null};all.push(e);
      if(bytes>maxBytes){e.admit=e.delivery='OVERSIZE';deniedTotal++;}
      else if(!waiting.length&&fits(e)){e.admit=e.delivery='OK';accepted.push(e);acceptedTotal++;}
      else if(waiting.length>=maxWaiters||sum(waiting)+bytes>maxPendingBytes){e.admit=e.delivery='WAITER_QUOTA';deniedTotal++;}
      else waiting.push(e);
    }
    assert.deepEqual(q.accounting,{acceptedRecords:accepted.length,acceptedBytes:sum(accepted),pendingRecords:waiting.length,pendingBytes:sum(waiting)});
    operations++;
  }
  const sealed=q.seal();for(const e of waiting)e.admit=e.delivery='CLOSED';waiting.length=0;release();
  assert.equal((await sealed).ok,true);
  assert.deepEqual(delivered,accepted.map(e=>e.str));
  for(const e of all){const a=await e.h.admitted,d=await e.h.delivered;assert.equal(a.ok?'OK':a.code,e.admit);assert.equal(d.ok?'OK':d.code,e.delivery);assert.equal(e.h.cancel(),false);}
  assert.deepEqual(q.accounting,{acceptedRecords:0,acceptedBytes:0,pendingRecords:0,pendingBytes:0});
}
console.log(JSON.stringify({operations,batches:128,acceptedTotal,cancelledTotal,deniedTotal,failures:0}));
