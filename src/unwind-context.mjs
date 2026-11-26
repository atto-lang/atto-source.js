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

  // Tokens are valid only for the current trusted callback invocation.
  // Not a guest-visible ABI: compiler provenance and isolation are still required.
  function enter_callback(recovery = false) {
    if (active_callback) throw new Error('E_CALLBACK_REENTRANT');
    active_callback = {signals:new WeakMap(), recovered:new WeakSet(), recovery};
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
    if (busy || retired) throw new Error(busy ? 'E_UNWIND_REENTRANT' : 'E_CONTEXT_RETIRED');
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
      busy = false;
    }
  }
  function* return_frame_steps(value) {
    check_available();
    if (!frames.length) throw new Error('E_NO_ACTIVE_FRAME');
    // Preserve the evaluated return slot before callbacks run.
    const pending = pending_outcome('return',null);
    busy = true;
    try {
      yield* pop_clean(pending);
      // A terminal cleanup failure cannot leave outer recovery scopes live.
      if (pending.kind !== 'return') while (frames.length) yield* pop_clean(pending);
      return pending.kind === 'return' ? Object.freeze({kind:'returned',value}) : terminal_view(pending);
    } finally {
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
        result = action.suspends ? await action.handler(...action.args) : invoke_sync(action);
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
  // Trusted host reference only: no external cancellation/deadline or
  // guest scheduler admission is implied. Pending cancellation is modeled
  // by dispatch_failure_async('cancel', error).
  function return_frame_async(value) {
    return run_async(return_frame_steps(value));
  }
  function dispatch_failure_async(kind,error) {
    return run_async(dispatch_failure_steps(kind,error));
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
    recovered,
    signal_failure,
    retire() {
      check_available();
      if (frames.length) throw new Error('E_CONTEXT_NOT_QUIESCENT');
      retired = true;
    },
  });
}
