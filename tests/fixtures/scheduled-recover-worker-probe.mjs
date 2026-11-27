import * as runtime from '../../src/scheduled-unwind-runtime.mjs';
import {SelectableI64Future} from '../../src/selectable-i64-future.mjs';
import {createWorkerControlLoop} from '../../src/worker-control-loop.mjs';
export function createCompiledRecoveryProbe(guest,send){
  const input=new SelectableI64Future(),cleanup=new SelectableI64Future(),fallback=new SelectableI64Future();
  const original=Error('original'),check=(ok,msg)=>{if(!ok)throw Error(msg);};
  // One physical credit proves that the body/cleanup/recovery are one lifetime.
  const loop=createWorkerControlLoop({maxSuspended:1,onTurnError:e=>send({kind:'recover-error',message:String(e)})});
  loop.attachOwner('recover',1);
  let phase=0;
  const after=fn=>setTimeout(()=>{try{fn();}catch(e){send({kind:'recover-error',message:String(e)});}},0);
  const parked=(f,kind)=>{check(f.pendingWaiters===1,'missing parked Future');check(loop.stats.retainedOwners===1&&!loop.retireOwner('recover',1),'lease missing');send({kind});};
  return msg=>{
    if(msg.kind==='recover-start'){
      check(phase===0,'start twice');phase=1;
      check(guest.start(runtime,loop,'recover',{tenant_id:'worker',actor_id:1,generation:1},[input,cleanup,fallback],out=>{
        check(phase===4,'inline or premature recovery');check(out.kind==='recovered'&&out.value===42n&&out.error===original,'incorrect recovery');check(!loop.retireOwner('recover',1),'publication lease missing');phase=5;send({kind:'recover-done',value:String(out.value),sameError:out.error===original});
      }),'admission failed');
      after(()=>{check(cleanup.pendingWaiters===0&&fallback.pendingWaiters===0,'premature cleanup');parked(input,'recover-input-parked');});
    }else if(msg.kind==='recover-fail-input'){
      check(phase===1,'input out of order');phase=2;check(input.fail(original)&&!input.resolve(1n),'body duplicate');check(cleanup.pendingWaiters===0,'inline body resume');send({kind:'recover-after-input'});
      after(()=>{check(fallback.pendingWaiters===0,'premature recovery');parked(cleanup,'recover-cleanup-parked');});
    }else if(msg.kind==='recover-complete-cleanup'){
      check(phase===2,'cleanup out of order');phase=3;check(cleanup.resolve(0n),'cleanup completion');check(fallback.pendingWaiters===0,'inline cleanup resume');send({kind:'recover-after-cleanup'});
      after(()=>parked(fallback,'recover-fallback-parked'));
    }else if(msg.kind==='recover-complete-fallback'){
      check(phase===3,'fallback out of order');phase=4;check(fallback.resolve(42n)&&!fallback.resolve(7n),'fallback duplicate');check(phase===4,'inline recovery');send({kind:'recover-after-fallback'});
    }else if(msg.kind==='recover-retire'){
      check(phase===5&&loop.stats.retainedOwners===0&&loop.retireOwner('recover',1)&&loop.attachOwner('recover',2),'retire failed');send({kind:'recover-retired'});
    }
  };
}
