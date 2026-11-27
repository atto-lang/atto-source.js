// Experimental trusted-host TaskFuture<T> handle for portable task ABI v5.
// NOT source-language TaskFuture<T> lowering or proof of guest TaskScope/AOT.
// Result observation and task control are separate, affine rights.
export const TASK_FUTURE_HOST_V1 = 'atto.task-future.host.v1';

export function createTaskFutureHostV1({result,cancelTask,requestCooperate}={}) {
  if(!result || typeof result.then !== 'function' ||
      typeof cancelTask !== 'function' ||
      typeof requestCooperate !== 'function')
    throw new TypeError('E_TASK_FUTURE_HOST_ARGUMENT');
  const settlement = Promise.resolve(result);
  // Dropping the result observation right must not produce an unhandled host
  // rejection. This handler does not turn failure into success or detach work.
  void settlement.catch(() => {});
  let issued = false;
  function get_ready() {
    if(issued) throw new Error('E_TASK_RESULT_CONSUMED');
    issued = true;
    let observed = false;
    // Future<T> receipt: JS thenable, not a bare replayable Promise. The
    // single observation is consumed at await/then, never at get_ready().
    return Object.freeze({
      then(resolve,reject) {
        if(observed)
          return Promise.reject(new Error('E_TASK_RESULT_CONSUMED'))
            .then(resolve,reject);
        observed = true;
        return settlement.then(resolve,reject);
      }
    });
  }
  return Object.freeze({
    version:TASK_FUTURE_HOST_V1,
    get_ready,
    cancel_task() { cancelTask(); },
    cooperate() { requestCooperate(); },
    // Source-level 'await t' consumes the exact same unique result right as
    // await t.get_ready(), never creates another result/TaskId.
    then(resolve,reject) {
      try {return get_ready().then(resolve,reject);}
      catch(error){return Promise.reject(error).then(resolve,reject);}
    }
  });
}
