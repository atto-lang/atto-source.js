# JS backend: independent Atto math/hash/cell sources

- `library/atto.core/math.atto` is a closed-world, pure integer source
  module. New additive `compileOwnedCoreMath` compiles the verified
  program-v2 dialect into checked BigInt ESM, without host imports or runtime
  library fallbacks. A Node execution test invokes the generated module.
  This does **not** mean browser or full Atto compiler parity passed.
- `library/atto.core/hash.atto` defines the portable modulo-prime byte
  fold, but JS program-v2 lacks verified loop lowering, so it is **source
  only** until a real compiler-backed implementation is proven.
- `library/atto.core/cell.atto` declares pure borrowing policy helpers,
  not a usable `Cell<T>` or `RefCell<T>`. It issues no tokens, owns no
  shared memory, and does not protect mutation.

The Node test separately checks all source Git blob hashes and executes
only the supported math ESM subset. Full project CI, browser execution
and compiler guest parity are NOT_EXECUTED on this head. Adjacent
existing JS core-linked work #78 is preserved; no generic import resolver
or changed `compileFreestandingCore` behavior is introduced.
