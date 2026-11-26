/**
 * Bounded, trusted host reference model for AttoLang's per-logical-invocation
 * unwind chain. Not a source compiler or an isolation boundary for guest JS.
 *
 * All callbacks supplied here must be compiler-generated/trusted. An actual
 * backend additionally needs nominal Error validation, owned captures, sealed
 * task identity, scope-accurate catch activation, and supervisor transport.
 */
const MAX_FRAMES = 128;
const MAX_REGISTRATIONS = 1024;
const MAX_SUPPRESSED = 16;
const failure_rank = new Map([['return',0],['throw',1],['raise',2],['panic',3],['cancel',4],['host-fatal',5]]);

const failure_kinds = new Set(['throw', 'raise', 'panic', 'cancel', 'host-fatal']);
const recoverable_kinds = new Set(['throw', 'raise']);

function require_function(value) {
  if (typeof value !== 'function') throw new TypeError('E_TRUSTED_CALLBACK_REQUIRED');
}
function require_error(value) {
  if (!(value instanceof Error)) throw new TypeError('E_ERROR_REQUIRED');
}
function append_suppressed(pending, error, kind = pending.kind) {
  if (pending.suppressed.length < MAX_SUPPRESSED) {
    pending.suppressed.push(error);
    pending.suppressed_kinds.push(kind);
  } else pending.suppressed_overflow++;
}
function pending_outcome(kind, error) {
  return {kind,error,suppressed:[],suppressed_kinds:[],suppressed_overflow:0};
}
function merge_failure(pending, kind, error) {
  if (failure_rank.get(kind) > failure_rank.get(pending.kind)) {
    if (pending.kind !== 'return') append_suppressed(pending,pending.error,pending.kind);
    pending.kind = kind;
    pending.error = error;
  } else append_suppressed(pending,error,kind);
}
function terminal_view(pending) {
  return Object.freeze({
    kind: 'unhandled',
    failure_kind: pending.kind,
    error: pending.error,
    suppressed: Object.freeze([...pending.suppressed]),
    suppressed_kinds: Object.freeze([...pending.suppressed_kinds]),
    suppressed_overflow: pending.suppressed_overflow,
  });
}

export function create_execution_context({tenant_id, actor_id, generation} = {}) {
  if (typeof tenant_id !== 'string' || !tenant_id ||
      !Number.isSafeInteger(actor_id) || actor_id < 0 ||
      !Number.isSafeInteger(generation) || generation <= 0)
    throw new TypeError('E_CONTEXT_OWNER');
  const owner = Object.freeze({tenant_id, actor_id, generation});
  const frames = [];
  let registrations = 0;
  let busy = false;
  let retired = false;
  let active_callback = null;
  let active_pending = null;
  let awaiting_callback = false;
  let cancel_requested = false;
  let scheduled_admission = false;
  let scheduled_driver = false;
  const issued_steps = new WeakSet();

  // Tokens are valid only for the current trusted callback invocation.
  // Not a guest-visible ABI: compiler provenance and isolation are still required.
  function enter_callback(recovery = false) {
    if (active_callback) throw new Error('E_CALLBACK_REENTRANT');
    active_callback = {signals:new WeakMap(), recovered:new WeakSet(), steps:new WeakMap(), recovery};
  }
  function signal_failure(kind, error) {
    if (!active_callback) throw new Error('E_NO_ACTIVE_CALLBACK');
    if (!['throw','raise','panic','cancel'].includes(kind)) throw new TypeError('E_INVALID_FAILURE_KIND');
    require_error(error);
    const token = Object.freeze(Object.create(null));
    active_callback.signals.set(token,{kind,error});
    throw token;
  }
  function callback_failure(pending, error, fallback) {
    const signal = active_callback?.signals.get(error);
    if (signal) {
      active_callback.signals.delete(error);
      merge_failure(pending, recoverable_kinds.has(signal.kind) ? 'panic' : signal.kind, signal.error);
    } else {
      merge_failure(pending,'host-fatal',error instanceof Error ? error : new Error(fallback));
    }
  }

  function check_available() {
    if (busy || scheduled_admission || retired) throw new Error(busy || scheduled_admission ? 'E_UNWIND_REENTRANT' : 'E_CONTEXT_RETIRED');
  }
  function current_frame() {
    check_available();
    const frame = frames.at(-1);
    if (!frame) throw new Error('E_NO_ACTIVE_FRAME');
    return frame;
  }
  function reserve() {
    if (registrations >= MAX_REGISTRATIONS) throw new RangeError('E_UNWIND_REGISTRATION_LIMIT');
    registrations++;
  }
  function* cleanup(frame, pending) {
    // Retire each cleanup before execution: even an error cannot run it twice.
    for (let i = frame.defers.length - 1; i >= 0; i--) {
      const callback = frame.defers[i];
      frame.defers[i] = null;
      registrations--;
      enter_callback();
      try {
        yield { ...callback, args:[], diagnostic:'E_ASYNC_CLEANUP_UNSUPPORTED' };
      } catch (error) {
        callback_failure(pending,error,'E_HOST_CALLBACK_FAILED');
      } finally {
        active_callback = null;
      }
    }
    frame.defers.length = 0;
    registrations -= frame.recovers.length + frame.catches.length;
    frame.catches.length = 0;
    frame.active = false;
  }
  function* pop_clean(pending) {
    const frame = frames.pop();
    yield* cleanup(frame, pending);
    return frame;
  }
  function recovered(value) {
    // A decision belongs to this invocation, not another context or callback.
    if (!active_callback?.recovery) throw new Error('E_NO_ACTIVE_RECOVERY');
    const token = Object.freeze({value});
    active_callback.recovered.add(token);
    return token;
  }
  function* dispatch_failure_steps(kind, error) {
    check_available();
    if (!failure_kinds.has(kind)) throw new TypeError('E_INVALID_FAILURE_KIND');
    require_error(error);
    const pending = pending_outcome(kind,error);
    busy = true;
    active_pending = pending;
    cancel_requested = kind === 'cancel';
    try {
      // Phase 1: search *all* dynamic frames for an ordinary catch/trap.
      // Never invoke a recover handler until this complete search ends.
      let catcher = null;
      if (kind === 'throw') {
        find_catch: for (let f = frames.length - 1; f >= 0; f--) {
          for (let c = frames[f].catches.length - 1; c >= 0; c--) {
            const entry = frames[f].catches[c];
            try {
              if (error instanceof entry.error_type) {
                catcher = {frame_index:f, handler:entry.handler};
                break find_catch;
              }
            } catch (host_error) {
              merge_failure(pending,'host-fatal',host_error instanceof Error ? host_error : new Error('E_HOST_CATCH_MATCH_FAILED'));
              break find_catch;
            }
          }
        }
      }
      if (catcher && pending.kind === 'throw') {
        // Phase 2a: unwind inner scopes, preserving the handling frame.
        while (frames.length - 1 > catcher.frame_index) yield* pop_clean(pending);
        if (pending.kind === 'throw') {
          try {
            const result = yield {handler:catcher.handler, suspends:false, args:[error], diagnostic:'E_ASYNC_CATCH_UNSUPPORTED'};
            return Object.freeze({kind:'caught', value:result, error});
          } catch (host_error) {
            merge_failure(pending,'host-fatal',host_error instanceof Error ? host_error : new Error('E_HOST_CATCH_FAILED'));
          }
        }
      }
      // Phase 2b: no eligible catch (or fatal host callback); perform cleanup
      // from the innermost frame outwards, then offer LIFO recovery callbacks.
      while (frames.length) {
        const frame = yield* pop_clean(pending);
        if (!recoverable_kinds.has(pending.kind)) continue;
        for (let i = frame.recovers.length - 1; i >= 0; i--) {
          if (!recoverable_kinds.has(pending.kind)) break;
          const handler = frame.recovers[i];
          const NEXT = Symbol('invocation-local recovery delegation');
          let valid = true;
          let delegated = false;
          const cursor = Object.freeze(Object.assign(Object.create(null), {
            next() {
              if (!valid) throw new Error('E_RECOVERY_CURSOR_STALE');
              if (delegated) throw new Error('E_RECOVERY_CURSOR_USED');
              delegated = true;
              throw NEXT;
            },
          }));
          const error_view = Object.freeze({message:pending.error.message, is_raise:pending.kind==='raise'});
          enter_callback(true);
          try {
            const result = yield { ...handler, args:[error_view,cursor], diagnostic:'E_ASYNC_RECOVER_UNSUPPORTED' };
            // An external scheduler cancellation may arrive while awaiting the
            // trusted handler. Its successful decision may not erase that exit.
            if (!recoverable_kinds.has(pending.kind)) break;
            if (delegated || !result || !active_callback.recovered.has(result))
              throw new TypeError('E_RECOVERY_DECISION_REQUIRED');
            return Object.freeze({kind:'recovered', value:result.value, error:pending.error});
          } catch (callback_error) {
            if (callback_error === NEXT && delegated) continue;
            callback_failure(pending,callback_error,'E_HOST_RECOVER_FAILED');
            break;
          } finally {
            valid = false;
            active_callback = null;
          }
        }
      }
      return terminal_view(pending);
    } finally {
      active_pending = null;
      awaiting_callback = false;
      cancel_requested = false;
      busy = false;
    }
  }
  function* return_frame_steps(value) {
    check_available();
    if (!frames.length) throw new Error('E_NO_ACTIVE_FRAME');
    // Preserve the evaluated return slot before callbacks run.
    const pending = pending_outcome('return',null);
    busy = true;
    active_pending = pending;
    cancel_requested = false;
    try {
      yield* pop_clean(pending);
      // A terminal cleanup failure cannot leave outer recovery scopes live.
      if (pending.kind !== 'return') while (frames.length) yield* pop_clean(pending);
      return pending.kind === 'return' ? Object.freeze({kind:'returned',value}) : terminal_view(pending);
    } finally {
      active_pending = null;
      awaiting_callback = false;
      cancel_requested = false;
      busy = false;
    }
  }
  // Both entry points drive the same ordered unwind machine. A synchronous
  // entry rejects *before* removing frames if any registered callback may
  // suspend (conservative for outer frames and unselected recovery handlers).
  function sync_preflight() {
    check_available();
    if (frames.some(f => [...f.defers,...f.recovers].some(c => c?.suspends)))
      throw new Error('E_SUSPENDING_UNWIND_REQUIRES_ASYNC_ENTRY');
  }
  function invoke_sync(action) {
    const result = action.handler(...action.args);
    if (result && typeof result.then === 'function') {
      // A mistakenly returned native Promise must not trigger an unhandled
      // rejection. No success or suspension support is inferred from it.
      if (result instanceof Promise) result.catch(()=>{});
      throw new TypeError(action.diagnostic);
    }
    return result;
  }
  function run_sync(steps) {
    let step = steps.next();
    while (!step.done) {
      let result;
      try { result = invoke_sync(step.value); }
      catch (error) { step = steps.throw(error); continue; }
      step = steps.next(result);
    }
    return step.value;
  }
  async function run_async(steps) {
    let step = steps.next();
    while (!step.done) {
      const action = step.value;
      let result;
      try {
        if (action.suspends) {
          const promise = action.handler(...action.args);
          awaiting_callback = true;
          try { result = await promise; }
          finally { awaiting_callback = false; }
        } else result = invoke_sync(action);
      } catch (error) { step = steps.throw(error); continue; }
      step = steps.next(result);
    }
    return step.value;
  }
  function return_frame(value) {
    sync_preflight();
    return run_sync(return_frame_steps(value));
  }
  function dispatch_failure(kind,error) {
    sync_preflight();
    return run_sync(dispatch_failure_steps(kind,error));
  }
  // Trusted host scheduler ingress only, not an Atto guest capability.
  // Cancellation seals the pending result but lets the active callback settle
  // before further unwind/retirement. No forced deadline is implemented.
  function request_cancel(error) {
    require_error(error);
    if (!busy || !awaiting_callback || !active_pending)
      throw new Error('E_NO_SUSPENDED_UNWIND');
    if (cancel_requested) return false;
    cancel_requested = true;
    merge_failure(active_pending,'cancel',error);
    return true;
  }
  // Trusted host reference only: scheduler authentication and bounded
  // cancellation deadlines remain compiler/runtime integration gates.
  function legacy_async_preflight() {
    check_available();
    if (frames.some(f => [...f.defers,...f.recovers].some(c => c?.scheduled)))
      throw new Error('E_SCHEDULED_UNWIND_REQUIRED');
  }
  function return_frame_async(value) {
    legacy_async_preflight();
    return run_async(return_frame_steps(value));
  }
  function dispatch_failure_async(kind,error) {
    legacy_async_preflight();
    return run_async(dispatch_failure_steps(kind,error));
  }

  // Trusted compiler-emitted synchronous quanta only. Native async callbacks
  // must be rejected BEFORE invocation, not after their Promise escapes.
  const excluded_prototypes = new Set([
    Object.getPrototypeOf(async function(){}),
    Object.getPrototypeOf(function*(){}),
    Object.getPrototypeOf(async function*(){}),
  ]);
  function require_quantum(fn) {
    require_function(fn);
    for (let p=Object.getPrototypeOf(fn), n=0; p!==null; p=Object.getPrototypeOf(p), n++)
      if (n>=32 || excluded_prototypes.has(p)) throw new TypeError('E_SYNC_QUANTUM_REQUIRED');
    const tag=Object.prototype.toString.call(fn);
    if (tag==='[object AsyncFunction]' || tag==='[object GeneratorFunction]' ||
        tag==='[object AsyncGeneratorFunction]') throw new TypeError('E_SYNC_QUANTUM_REQUIRED');
  }
  function reject_thenable(value) {
    if (value && typeof value.then==='function') {
      if (value instanceof Promise) value.catch(()=>{});
      throw new TypeError('E_SCHEDULED_PROMISE_FORBIDDEN');
    }
  }
  // arm is a trusted reactor registration callback; it may publish completion
  // synchronously, but never runs guest code. resume is a generated quantum.
  function suspend_step(arm,resume) {
    if (!scheduled_driver || !active_callback || awaiting_callback)
      throw new Error('E_NO_ACTIVE_SCHEDULED_CALLBACK');
    require_quantum(arm); require_quantum(resume);
    const token=Object.freeze(Object.create(null));
    active_callback.steps.set(token,{arm,resume});
    issued_steps.add(token);
    return token;
  }
  // Reuse the exact same unwind state machine as the host reference driver.
  // The caller must retain the owning scheduler generation until quiescence.
  // Scheduler shutdown/retirement coordination is a separate integration gate:
  // dropping a ticket must NOT be reported as successful cleanup.
  function start_scheduled(steps,scheduler,owner_key,on_done) {
    check_available(); require_quantum(on_done);
    if (frames.some(f => [...f.defers,...f.recovers].some(c => c?.suspends&&!c.scheduled)))
      throw new Error('E_LEGACY_ASYNC_UNWIND_FORBIDDEN');
    if (!scheduler || !['admitData','beginSuspension','complete','cancel'].every(k=>typeof scheduler[k]==='function'))
      throw new TypeError('E_SCHEDULER_REQUIRED');
    const epoch=owner.generation;
    let step, action;
    function finish(value) {
      scheduled_driver=false;
      on_done(value);
    }
    function drive(result,failed=false,has_result=false) {
      // Every call is on the scheduler lane, including resume after a wakeup.
      while (true) {
        if (has_result && !failed) {
          try {
            reject_thenable(result);
            if (issued_steps.has(result)) {
              const wait=active_callback?.steps.get(result);
              if (!action.scheduled || !wait) throw new Error('E_INVALID_SUSPENSION_STEP');
              active_callback.steps.delete(result);
              const ticket=scheduler.beginSuspension(owner_key,epoch,completion=>{
                awaiting_callback=false;
                let next, error=false;
                try {
                  if (!completion.ok) throw completion.value;
                  next=wait.resume(completion.value);
                } catch (e) { next=e; error=true; }
                drive(next,error,true);
              });
              if (!ticket) throw new Error('E_SUSPENSION_ADMISSION');
              awaiting_callback=true;
              try {
                reject_thenable(wait.arm(
                  value=>scheduler.complete(ticket,{ok:true,value}),
                  error=>scheduler.complete(ticket,{ok:false,value:error})
                ));
              } catch (e) {
                scheduler.cancel(ticket);
                awaiting_callback=false;
                throw e;
              }
              return; // Never resume a parked callback from this turn.
            }
          } catch(e) { result=e; failed=true; }
        }
        step=has_result ? (failed ? steps.throw(result) : steps.next(result)) : steps.next();
        if (step.done) { finish(step.value); return; }
        action=step.value;
        has_result=true; failed=false;
        try {
          require_quantum(action.handler);
          result=action.handler(...action.args);
        } catch(e) { result=e; failed=true; }
      }
    }
    scheduled_admission=true;
    let admitted=false;
    try {
      admitted=scheduler.admitData(owner_key,epoch,()=>{
        scheduled_admission=false;
        scheduled_driver=true;
        try { drive(undefined); }
        catch(e) { scheduled_driver=false; throw e; }
      });
      return admitted;
    } finally {
      if (!admitted) scheduled_admission=false;
    }
  }
  function return_frame_scheduled(value,scheduler,owner_key,on_done) {
    if (!frames.length) throw new Error('E_NO_ACTIVE_FRAME');
    return start_scheduled(return_frame_steps(value),scheduler,owner_key,on_done);
  }
  function dispatch_failure_scheduled(kind,error,scheduler,owner_key,on_done) {
    if (!failure_kinds.has(kind)) throw new TypeError('E_INVALID_FAILURE_KIND');
    require_error(error);
    return start_scheduled(dispatch_failure_steps(kind,error),scheduler,owner_key,on_done);
  }
  return Object.freeze({
    owner,
    get depth() { return frames.length; },
    push_frame(scope_id) {
      check_available();
      if (!Number.isSafeInteger(scope_id) || scope_id < 0) throw new TypeError('E_SCOPE_ID');
      if (frames.length >= MAX_FRAMES) throw new RangeError('E_UNWIND_FRAME_LIMIT');
      frames.push({scope_id,defers:[],recovers:[],catches:[],active:true});
    },
    register_defer(handler) {
      const frame = current_frame(); require_function(handler); reserve();
      frame.defers.push({handler,suspends:false});
    },
    register_recover(handler) {
      const frame = current_frame(); require_function(handler); reserve();
      frame.recovers.push({handler,suspends:false});
    },
    register_susp_defer(handler) {
      const frame = current_frame(); require_function(handler); reserve();
      frame.defers.push({handler,suspends:true});
    },
    register_susp_recover(handler) {
      const frame = current_frame(); require_function(handler); reserve();
      frame.recovers.push({handler,suspends:true});
    },
    register_scheduled_defer(handler) {
      const frame=current_frame(); require_quantum(handler); reserve();
      frame.defers.push({handler,suspends:true,scheduled:true});
    },
    register_scheduled_recover(handler) {
      const frame=current_frame(); require_quantum(handler); reserve();
      frame.recovers.push({handler,suspends:true,scheduled:true});
    },
    register_catch(error_type, handler) {
      const frame = current_frame(); require_function(handler);
      if (typeof error_type !== 'function' ||
          (error_type !== Error && !(error_type.prototype instanceof Error)) ||
          Object.hasOwn(error_type,Symbol.hasInstance))
        throw new TypeError('E_CATCH_TYPE');
      reserve(); frame.catches.push({error_type,handler});
    },
    return_frame,
    dispatch_failure,
    return_frame_async,
    dispatch_failure_async,
    request_cancel,
    return_frame_scheduled,
    dispatch_failure_scheduled,
    suspend_step,
    get unwind_busy() { return busy || scheduled_admission; },
    recovered,
    signal_failure,
    retire() {
      check_available();
      if (frames.length) throw new Error('E_CONTEXT_NOT_QUIESCENT');
      retired = true;
    },
  });
}
