import {create_execution_context} from '../../src/unwind-context.mjs';

// Same trusted host probe in actual Node and browser Workers. A host
// message may complete a ticket; guest-style continuation runs on a later turn.
export function createUnwindProbe(loop,send) {
  const owner='unwind-probe';
  let complete,ctx;
  return msg=>{
    if(msg?.kind==='unwind-start'){
      if(ctx)throw Error('duplicate probe start');
      loop.attachOwner(owner,1);
      ctx=create_execution_context({tenant_id:'worker-probe',actor_id:1,generation:1});
      ctx.push_frame(1);
      ctx.register_defer(()=>send({kind:'unwind-outer'}));
      ctx.register_scheduled_defer(()=>ctx.suspend_step(ok=>{
        complete=ok;
        send({kind:'unwind-parked',retirementBlocked:!loop.retireOwner(owner,1),closeBlocked:loop.close()===false});
      },value=>send({kind:'unwind-resumed',value})));
      if(!ctx.return_frame_scheduled(42,loop,owner,outcome=>{
        send({kind:'unwind-done',failure:outcome.failure_kind,retirementBlocked:!loop.retireOwner(owner,1)});
      }))throw Error('unwind admission failed');
      return true;
    }
    if(msg?.kind==='unwind-complete'){
      if(!loop.admitControl(owner,1,()=>ctx.request_cancel(Error('stop'))))throw Error('cancel admission failed');
      send({kind:'unwind-before'});
      const accepted=complete(msg.value),duplicate=complete(msg.value+1);
      send({kind:'unwind-after',accepted,duplicate});
      return true;
    }
    if(msg?.kind==='unwind-retire'){
      ctx.retire();
      const retired=loop.retireOwner(owner,1),attached=loop.attachOwner(owner,2),stale=complete(999);
      send({kind:'unwind-retired',retired,attached,stale,retained:loop.stats.retainedOwners});
      return true;
    }
    return false;
  };
}
