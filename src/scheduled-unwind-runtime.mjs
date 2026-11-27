// Trusted host adapter for explicitly compiled scheduled-unwind-v1 ESM.
// Not a guest-visible capability API or security boundary for hostile JS.
import {create_execution_context} from './unwind-context.mjs';
import {SelectableI64Future} from './selectable-i64-future.mjs';
export function validateFutures(futures,count){
  if(!Array.isArray(futures)||futures.length!==count||!Number.isSafeInteger(count)||count<1||count>8)
    throw new TypeError('E_SCHEDULED_FUTURE_ARITY');
  const snapshot=[];
  for(let i=0;i<count;i++){
    const d=Object.getOwnPropertyDescriptor(futures,String(i));
    if(!d||!Object.hasOwn(d,'value')||Object.getPrototypeOf(d.value??{})!==SelectableI64Future.prototype||snapshot.includes(d.value))
      throw new TypeError('E_SCHEDULED_FUTURE_IDENTITY');
    snapshot.push(d.value);
  }
  return Object.freeze(snapshot);
}
export function createContext(identity){return create_execution_context(identity);}
export function deferFuture(ctx,future){
  // The callback commits the Future's own one-shot subscription into a cell,
  // then publishes a scheduler completion. It never invokes a guest resume.
  return ctx.suspend_step((ok,fail)=>{
    const cell=future.createResultCell();
    future.subscribeReady(sub=>{
      try{
        if(!future.tryCommit(sub,cell))throw new Error('E_FUTURE_COMMIT');
        ok(Object.freeze({status:cell.status,error:cell.error}));
      }catch(error){sub.close();fail(error);}
    });
  },outcome=>{
    if(outcome.status==='value')return;
    if(outcome.status==='cancelled')ctx.signal_failure('cancel',new Error('E_FUTURE_CANCELLED'));
    if(outcome.status==='failed')ctx.signal_failure('raise',outcome.error);
    throw new Error('E_FUTURE_STATUS');
  });
}
