import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {once} from 'node:events';
import {Worker, isMainThread, parentPort, threadId} from 'node:worker_threads';
import {createWorkerControlLoop} from '../src/worker-control-loop.mjs';

// Real TCP on a single tenant Worker. Host runtime only, not compiled Atto.
if (!isMainThread) {
  const loop = createWorkerControlLoop({maxOwners:2,maxReady:1,maxSuspended:2,
    onTurnError(error){parentPort.postMessage({kind:'error',message:String(error)});}});
  let connections=0, inProducer=false;
  const server=net.createServer(socket=>{
    const owner=++connections===1?'a':'b';
    assert.ok(connections<=2);
    assert.ok(loop.attachOwner(owner,1));
    assert.ok(loop.admitData(owner,1,()=>{
      const ticket=loop.beginSuspension(owner,1,value=>{
        assert.equal(inProducer,false);
        parentPort.postMessage({kind:'resumed',owner,value,threadId});
        socket.end(Buffer.from([value]));
      });
      assert.ok(ticket);
      socket.once('data',bytes=>{
        assert.equal(bytes.length,1);
        inProducer=true;
        try {
          assert.equal(loop.complete(ticket,bytes[0]),true);
          assert.equal(loop.complete(ticket,99),false);
          parentPort.postMessage({kind:'settled',owner,threadId});
        } finally {inProducer=false;}
      });
      parentPort.postMessage({kind:'armed',owner,threadId});
    }));
    socket.on('error',e=>parentPort.postMessage({kind:'error',message:String(e)}));
  });
  server.on('error',e=>parentPort.postMessage({kind:'error',message:String(e)}));
  server.listen(0,'127.0.0.1',()=>{
    parentPort.postMessage({kind:'listening',port:server.address().port,threadId});
  });
  parentPort.on('message',msg=>{
    if(msg==='close'){
      assert.equal(loop.stats.suspended,0);
      assert.equal(loop.stats.completed,4);
      assert.equal(loop.stats.errors,0);
      assert.equal(loop.retireOwner('a',1),true);
      assert.equal(loop.retireOwner('b',1),true);
      loop.close();
      server.close(()=>{parentPort.postMessage({kind:'closed',stats:loop.stats});parentPort.close();});
    }
  });
} else {
  test('real TCP completion releases B before A on one Worker without inline resume or replay',
    {timeout:20000}, async()=>{
      const worker=new Worker(new URL(import.meta.url));
      const frames=[], sockets=[];
      let wake, failure;
      worker.on('message',frame=>{frames.push(frame);if(frame.kind==='error')failure=Error(frame.message);wake?.();});
      worker.on('error',error=>{failure=error;wake?.();});
      const exited=new Promise(resolve=>worker.once('exit',resolve));
      async function next(kind,owner){
        for(let attempts=0;attempts<100;attempts++){
          if(failure)throw failure;
          const match=frames.find(f=>f.kind===kind&&(!owner||f.owner===owner));
          if(match)return match;
          await new Promise(resolve=>{const timer=setTimeout(()=>{wake=null;resolve();},100);
            wake=()=>{clearTimeout(timer);wake=null;resolve();};});
        }
        throw Error('missing '+kind+' '+owner);
      }
      async function connect(port){
        const socket=net.createConnection({host:'127.0.0.1',port});
        sockets.push(socket);await once(socket,'connect');return socket;
      }
      function read(socket){
        const chunks=[];
        socket.on('data',bytes=>chunks.push(bytes));
        const end=once(socket,'end').then(()=>Buffer.concat(chunks));
        end.catch(()=>{});return end;
      }
      try {
        const listening=await next('listening');
        const a=await connect(listening.port), aRead=read(a);
        const armedA=await next('armed','a');
        const b=await connect(listening.port), bRead=read(b);
        const armedB=await next('armed','b');
        assert.equal(armedA.threadId,listening.threadId);
        assert.equal(armedB.threadId,listening.threadId);
        b.write(Buffer.from([7]));
        assert.equal((await next('resumed','b')).value,7);
        assert.deepEqual(await bRead,Buffer.from([7]));
        assert.equal(frames.some(f=>f.kind==='resumed'&&f.owner==='a'),false);
        a.write(Buffer.from([42]));
        assert.equal((await next('resumed','a')).value,42);
        assert.deepEqual(await aRead,Buffer.from([42]));
        const order=frames.filter(f=>['armed','settled','resumed'].includes(f.kind));
        assert.deepEqual(order.map(f=>f.kind+':'+f.owner),
          ['armed:a','armed:b','settled:b','resumed:b','settled:a','resumed:a']);
        assert.ok(order.every(f=>f.threadId===listening.threadId));
        worker.postMessage('close');
        const closed=await next('closed');
        assert.equal(closed.stats.closed,true);
        assert.equal(closed.stats.owners,0);
        assert.equal(await exited,0);
      } finally {for(const s of sockets)s.destroy();await worker.terminate();}
    });
}
