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
const NEXT = Symbol('private recovery delegation');
const RECOVERED = new WeakSet();

const failure_kinds = new Set(['throw', 'raise', 'panic', 'cancel', 'host-fatal']);
const recoverable_kinds = new Set(['throw', 'raise']);

function require_function(value) {
  if (typeof value !== 'function') throw new TypeError('E_TRUSTED_CALLBACK_REQUIRED');
}
function require_error(value) {
  if (!(value instanceof Error)) throw new TypeError('E_ERROR_REQUIRED');
}
function append_suppressed(pending, error) {
  if (pending.suppressed.length < MAX_SUPPRESSED) pending.suppressed.push(error);
}
function terminal_view(pending) {
  return Object.freeze({
    kind: 'unhandled',
    failure_kind: pending.kind,
    error: pending.error,
    suppressed: Object.freeze([...pending.suppressed]),
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
  function cleanup(frame, pending) {
    // Retire each cleanup before execution: even an error cannot run it twice.
    for (let i = frame.defers.length - 1; i >= 0; i--) {
      const callback = frame.defers[i];
      frame.defers[i] = null;
      registrations--;
      try {
        const result = callback();
        if (result && typeof result.then === 'function')
          throw new TypeError('E_ASYNC_CLEANUP_UNSUPPORTED');
      } catch (error) {
        // A host exception is never silently retagged as a guest throw/raise.
        const host_error = error instanceof Error ? error : new Error('E_HOST_CALLBACK_FAILED');
        if (pending.kind !== 'host-fatal') {
          if (pending.kind !== 'return') append_suppressed(pending,pending.error);
          pending.kind = 'host-fatal';
          pending.error = host_error;
        } else {
          append_suppressed(pending,host_error);
        }
      }
    }
    frame.defers.length = 0;
    registrations -= frame.recovers.length + frame.catches.length;
    frame.catches.length = 0;
    frame.active = false;
  }
  function pop_clean(pending) {
    const frame = frames.pop();
    cleanup(frame, pending);
    return frame;
  }
  function recovered(value) {
    // This creates a compiler-host-only result token, not a guest-accessible API.
    const token = Object.freeze({value});
    RECOVERED.add(token);
    return token;
  }
  function dispatch_failure(kind, error) {
    check_available();
    if (!failure_kinds.has(kind)) throw new TypeError('E_INVALID_FAILURE_KIND');
    require_error(error);
    const pending = {kind, error, suppressed: []};
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
              pending.kind = 'host-fatal';
              append_suppressed(pending,error);
              pending.error = host_error instanceof Error ? host_error : new Error('E_HOST_CATCH_MATCH_FAILED');
              break find_catch;
            }
          }
        }
      }
      if (catcher && pending.kind === 'throw') {
        // Phase 2a: unwind inner scopes, preserving the handling frame.
        while (frames.length - 1 > catcher.frame_index) pop_clean(pending);
        if (pending.kind === 'throw') {
          try {
            const result = catcher.handler(error);
            if (result && typeof result.then === 'function') throw new TypeError('E_ASYNC_CATCH_UNSUPPORTED');
            return Object.freeze({kind:'caught', value:result, error});
          } catch (host_error) {
            pending.kind = 'host-fatal';
            append_suppressed(pending,error);
            pending.error = host_error instanceof Error ? host_error : new Error('E_HOST_CATCH_FAILED');
          }
        }
      }
      // Phase 2b: no eligible catch (or fatal host callback); perform cleanup
      // from the innermost frame outwards, then offer LIFO recovery callbacks.
      while (frames.length) {
        const frame = pop_clean(pending);
        if (!recoverable_kinds.has(pending.kind)) continue;
        for (let i = frame.recovers.length - 1; i >= 0; i--) {
          const handler = frame.recovers[i];
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
          try {
            const result = handler(error_view, cursor);
            if (delegated || !result || !RECOVERED.has(result))
              throw new TypeError('E_RECOVERY_DECISION_REQUIRED');
            return Object.freeze({kind:'recovered', value:result.value, error:pending.error});
          } catch (callback_error) {
            if (callback_error === NEXT && delegated) continue;
            append_suppressed(pending,pending.error);
            pending.kind = 'host-fatal';
            pending.error = callback_error instanceof Error ? callback_error : new Error('E_HOST_RECOVER_FAILED');
            break;
          } finally {
            valid = false;
          }
        }
      }
      return terminal_view(pending);
    } finally {
      busy = false;
    }
  }
  function return_frame(value) {
    check_available();
    if (!frames.length) throw new Error('E_NO_ACTIVE_FRAME');
    // Preserve the evaluated return slot before callbacks run.
    const pending = {kind:'return',error:null,suppressed:[]};
    busy = true;
    try {
      pop_clean(pending);
      return pending.kind === 'return' ? Object.freeze({kind:'returned',value}) : terminal_view(pending);
    } finally {
      busy = false;
    }
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
      frame.defers.push(handler);
    },
    register_recover(handler) {
      const frame = current_frame(); require_function(handler); reserve();
      frame.recovers.push(handler);
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
    recovered,
    retire() {
      check_available();
      if (frames.length) throw new Error('E_CONTEXT_NOT_QUIESCENT');
      retired = true;
    },
  });
}
