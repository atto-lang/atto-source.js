import * as runtime from '../../src/scheduled-unwind-runtime.mjs';
import {createWorkerControlLoop} from '../../src/worker-control-loop.mjs';
import {SelectableI64Future} from '../../src/selectable-i64-future.mjs';

// Host-only message adapter; guest code is exclusively the emitted ESM.
export function createCompiledUnwindProbe(guest,send){
  let phase=0;
  const first=new SelectableI64Future(),second=new SelectableI64Future();
  const loop=createWorkerControlLoop({onTurnError:e=>send({kind:'guest-error',message:String(e)})});
  loop.attachOwner('guest',1);
  const check=(ok,msg)=>{if(!ok)throw Error(msg);};
  const afterTurn=fn=>setTimeout(()=>{try{fn();}catch(e){send({kind:'guest-error',message:String(e)});}},0);
  return msg=>{
    if(msg.kind==='guest-start'){
      check(phase===0,'duplicate start');phase=1;
      check(guest.start(runtime,loop,'guest',{tenant_id:'worker',actor_id:1,generation:1},[first,second],outcome=>{
        check(phase===3,'early terminal publication');
        check(outcome.kind==='returned'&&outcome.value===42n,'wrong result');
        check(!loop.retireOwner('guest',1),'early retirement');
        phase=4;send({kind:'guest-done',value:String(outcome.value)});
      }),'admission');
      afterTurn(()=>{
        check(second.pendingWaiters===1&&first.pendingWaiters===0,'not parked LIFO');
        check(!loop.retireOwner('guest',1),'retired while parked');
        send({kind:'guest-parked'});
      });
    }else if(msg.kind==='guest-second'){
      check(phase===1,'second out of order');phase=2;
      send({kind:'guest-before-second'});
      check(second.resolve(2n)&&!second.resolve(3n),'duplicate completion');
      check(first.pendingWaiters===0,'inline resumption');
      send({kind:'guest-after-second'});
      afterTurn(()=>{check(first.pendingWaiters===1,'older defer not parked');send({kind:'guest-first-parked'});});
    }else if(msg.kind==='guest-first'){
      check(phase===2,'first out of order');phase=3;
      check(first.resolve(1n),'first completion');check(phase===3,'inline guest completion');
      send({kind:'guest-after-first'});
    }else if(msg.kind==='guest-retire'){
      check(phase===4,'not done');
      check(loop.stats.retainedOwners===0&&loop.retireOwner('guest',1)&&loop.attachOwner('guest',2),'retirement failed');
      check(!first.resolve(99n)&&!second.resolve(99n),'stale Future completed');
      send({kind:'guest-retired'});
    }
  };
}
