// Declarative reactive state v1: fine-grained signals and a keyed list
// differ, independent of any renderer (DOM, AttoXP native widgets, TUI).
//
// Semantics (the contract other backends must match):
//  * signal(v): a mutable cell. Writes with Object.is-equal values are
//    no-ops, so nothing downstream re-runs.
//  * computed(fn): lazy and memoized. It re-evaluates only when read AND a
//    source version changed. If the new value is Object.is-equal to the old
//    one, its version does not advance (equality cutoff), so dependants and
//    effects do not re-run.
//  * Glitch-free: evaluation is pull-based in dependency order, so no
//    computed or effect ever observes a mix of old and new values from one
//    write or batch.
//  * effect(fn): runs once, then after any write/batch that changes a value
//    it read. Dependencies are re-tracked on every run (conditional reads
//    drop stale subscriptions). fn may return a cleanup, run before the next
//    run and on dispose. Effects run in creation order after the outermost
//    batch.
//  * Fail closed: a cycle (E_REACTIVE_CYCLE), a write inside computed
//    (E_REACTIVE_WRITE_IN_COMPUTED), or effects that keep re-triggering
//    beyond a bound (E_REACTIVE_EFFECT_LOOP) throw instead of hanging.

export class ReactiveError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

const MAX_EFFECT_ROUNDS = 100;
let tracking = null; // node currently collecting dependencies
let computing = 0; // depth of computed evaluation
let batchDepth = 0;
let flushing = false;
let effectSeq = 0;
const pending = new Set();

function track(node) {
  if (tracking) tracking.sources.set(node, node.version);
}

function notify(node) {
  for (const obs of node.observers) {
    if (obs.kind === 'effect') {
      if (!obs.disposed) pending.add(obs);
    } else if (!obs.notified) {
      obs.notified = true;
      notify(obs);
    }
  }
}

function unsubscribe(node) {
  for (const src of node.sources.keys()) src.observers.delete(node);
}

function runTracked(node, fn) {
  const prevSources = node.sources;
  node.sources = new Map();
  const prevTracking = tracking;
  tracking = node;
  try {
    return fn();
  } finally {
    tracking = prevTracking;
    for (const src of prevSources.keys()) if (!node.sources.has(src)) src.observers.delete(node);
    for (const src of node.sources.keys()) src.observers.add(node);
  }
}

// True if any source changed since `node` last ran (refreshing computeds first).
function sourcesChanged(node) {
  for (const [src, seen] of node.sources) {
    if (src.kind === 'computed') refresh(src);
    if (src.version !== seen) return true;
  }
  return false;
}

function refresh(c) {
  if (c.evaluating) throw new ReactiveError('E_REACTIVE_CYCLE', 'computed depends on itself');
  if (c.initialized && !c.notified) return;
  if (c.initialized && !sourcesChanged(c)) {
    c.notified = false;
    return;
  }
  c.evaluating = true;
  computing++;
  try {
    const next = runTracked(c, c.fn);
    if (!c.initialized || !Object.is(next, c.value)) {
      c.value = next;
      c.version++;
    }
    c.initialized = true;
    c.notified = false;
  } finally {
    computing--;
    c.evaluating = false;
  }
}

function flush() {
  if (flushing || batchDepth > 0) return;
  flushing = true;
  try {
    for (let round = 0; pending.size > 0; round++) {
      if (round >= MAX_EFFECT_ROUNDS) {
        pending.clear();
        throw new ReactiveError('E_REACTIVE_EFFECT_LOOP', `effects re-triggered for more than ${MAX_EFFECT_ROUNDS} rounds`);
      }
      const batch = [...pending].sort((a, b) => a.seq - b.seq);
      pending.clear();
      for (const e of batch) if (!e.disposed && sourcesChanged(e)) runEffect(e);
    }
  } finally {
    flushing = false;
  }
}

function runEffect(e) {
  if (typeof e.cleanup === 'function') e.cleanup();
  e.cleanup = runTracked(e, e.fn);
}

export function signal(initial) {
  const node = { kind: 'signal', value: initial, version: 0, observers: new Set() };
  return Object.freeze({
    get() {
      track(node);
      return node.value;
    },
    peek: () => node.value,
    set(next) {
      if (computing > 0) throw new ReactiveError('E_REACTIVE_WRITE_IN_COMPUTED', 'computed values must be pure');
      if (Object.is(next, node.value)) return;
      node.value = next;
      node.version++;
      notify(node);
      flush();
    },
    update(f) {
      this.set(f(node.value));
    },
  });
}

export function computed(fn) {
  const node = {
    kind: 'computed', fn, value: undefined, version: 0, initialized: false,
    notified: false, evaluating: false, sources: new Map(), observers: new Set(),
  };
  return Object.freeze({
    get() {
      refresh(node);
      track(node);
      return node.value;
    },
  });
}

export function effect(fn) {
  const node = { kind: 'effect', fn, sources: new Map(), cleanup: undefined, disposed: false, seq: effectSeq++ };
  runEffect(node);
  return function dispose() {
    if (node.disposed) return;
    node.disposed = true;
    pending.delete(node);
    unsubscribe(node);
    if (typeof node.cleanup === 'function') node.cleanup();
  };
}

/** Group writes: effects run once, after the outermost batch. */
export function batch(fn) {
  batchDepth++;
  try {
    return fn();
  } finally {
    batchDepth--;
    flush();
  }
}

/** Read without subscribing. */
export function untracked(fn) {
  const prev = tracking;
  tracking = null;
  try {
    return fn();
  } finally {
    tracking = prev;
  }
}

// ---------------------------------------------------------------------------
// Keyed list reconciliation. Produces renderer-neutral ops that transform
// `oldKeys` into `newKeys` with the minimum number of moves: items on a
// longest increasing subsequence of old positions stay put.
//   {op:'remove', key}
//   {op:'insert', key, before}   // before: key or null (append)
//   {op:'move',   key, before}
// Ops apply in order to a live list (DOM/AttoXP child list semantics).
// ---------------------------------------------------------------------------

function lisIndices(seq) {
  const tails = [];
  const prev = new Array(seq.length).fill(-1);
  for (let i = 0; i < seq.length; i++) {
    if (seq[i] < 0) continue;
    let lo = 0, hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]] < seq[i]) lo = mid + 1; else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const out = new Set();
  for (let k = tails.length ? tails[tails.length - 1] : -1; k >= 0; k = prev[k]) out.add(k);
  return out;
}

function assertUnique(keys, label) {
  const seen = new Set();
  for (const k of keys) {
    if (seen.has(k)) throw new ReactiveError('E_REACTIVE_DUPLICATE_KEY', `duplicate key ${String(k)} in ${label} list`);
    seen.add(k);
  }
}

export function diffKeyed(oldKeys, newKeys) {
  assertUnique(oldKeys, 'old');
  assertUnique(newKeys, 'new');
  const ops = [];
  const newSet = new Set(newKeys);
  for (const k of oldKeys) if (!newSet.has(k)) ops.push({ op: 'remove', key: k });
  const kept = oldKeys.filter((k) => newSet.has(k));
  const oldPos = new Map(kept.map((k, i) => [k, i]));
  const seq = newKeys.map((k) => (oldPos.has(k) ? oldPos.get(k) : -1));
  const stable = lisIndices(seq);
  // Walk backwards so each `before` anchor is already in its final place.
  for (let i = newKeys.length - 1; i >= 0; i--) {
    const key = newKeys[i];
    const before = i + 1 < newKeys.length ? newKeys[i + 1] : null;
    if (seq[i] < 0) ops.push({ op: 'insert', key, before });
    else if (!stable.has(i)) ops.push({ op: 'move', key, before });
  }
  return ops;
}

/** Reference applier (also what a host renderer must be equivalent to). */
export function applyKeyedOps(list, ops) {
  const out = list.slice();
  for (const o of ops) {
    if (o.op === 'remove' || o.op === 'move') {
      const at = out.indexOf(o.key);
      if (at < 0) throw new ReactiveError('E_REACTIVE_BAD_OP', `${o.op} of missing key ${String(o.key)}`);
      out.splice(at, 1);
      if (o.op === 'remove') continue;
    }
    const at = o.before === null ? out.length : out.indexOf(o.before);
    if (at < 0) throw new ReactiveError('E_REACTIVE_BAD_OP', `anchor ${String(o.before)} missing`);
    out.splice(at, 0, o.key);
  }
  return out;
}
