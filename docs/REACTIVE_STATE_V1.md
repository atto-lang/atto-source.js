# UI framework and declarative reactive state v1

Status: **draft, first executable slice** (renderer-agnostic runtime for the
JS backend). Feature 13 of the 15 proposals.

## Shape

AttoXP (native widgets) and the browser/DOM target both need the same thing
from the language: **declarative state that recomputes the minimum and
re-renders the minimum**. This slice specifies and implements that core
without any renderer:

```
signal ──▶ computed ──▶ effect (renderer binding)
                │
                └──▶ keys ──▶ diffKeyed ──▶ insert/move/remove ops ──▶ host
```

## Semantics (`src/reactive-state-v1.mjs`)

| Primitive | Contract |
| --- | --- |
| `signal(v)` | Mutable cell; `Object.is`-equal writes are no-ops. |
| `computed(fn)` | Lazy and memoized. Re-evaluates only when read **and** a source version changed. An equal result does not advance its version (equality cutoff), so nothing downstream re-runs. |
| `effect(fn)` | Runs immediately, then after changes to anything it read. Dependencies are re-tracked each run. The optional returned cleanup runs before a re-run and on `dispose()`. |
| `batch(fn)` | Coalesces writes; effects run once after the outermost batch, in creation order. |
| `untracked(fn)` | Read without subscribing. |

**Glitch-free:** evaluation is pull-based in dependency order, so in a
diamond (`first/last → full, initials → effect`) the effect never sees a mix
of old and new values.

**Fail closed:** a self-dependency gives `E_REACTIVE_CYCLE`. A write inside a
computed gives `E_REACTIVE_WRITE_IN_COMPUTED` (computeds must be pure). Effects
re-triggering for more than 100 rounds give `E_REACTIVE_EFFECT_LOOP`; the
system stays usable afterwards.

### Keyed lists
`diffKeyed(oldKeys, newKeys)` emits renderer-neutral `remove`, `insert` and
`move` ops (`before` anchor or `null`). Items on a longest increasing
subsequence stay put, so the number of moves is minimal. `applyKeyedOps` is
the reference applier a host must be equivalent to. Duplicate keys give
`E_REACTIVE_DUPLICATE_KEY`.

## Tests: `tests/reactive-state-v1.test.mjs` (10 cases)
Diamond glitch freedom, laziness and memoization with equality cutoff,
dynamic re-tracking, cleanup and dispose, nested batch ordering, untracked
reads, the fail-closed matrix, **500 randomized keyed diffs** that check both
correctness and minimal move count against an independent LIS, edge cases,
and an end-to-end signal-driven keyed view.

## Proposed AttoLang surface (for spec review)

```atto
define component TodoList as
  state List<Todo> todos = [];
  derived int remaining = todos.count(|t| !t.done);
  view {
    Text("{remaining} left");
    for t in todos key t.id { TodoRow(t) }
  }
end
```

`state` lowers to `signal`, `derived` to `computed`, `view` to an effect that
produces host ops, and `for … key` to `diffKeyed`. Because the state graph is
actor-local, a component is owned by one actor/UI thread, and cross-actor
updates arrive as messages. That keeps actors independent of each other.

## Next slices
1. Port the same contract to the LLVM scalar guest used by AttoXP (ops
   become host calls through the existing `axp_ui_submit_v1` ABI).
2. A shared conformance corpus (op traces) across JS, AttoXP and Java.
3. Compiler lowering of `state`/`derived`/`view`.
