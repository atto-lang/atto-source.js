# JS backend: independent Atto math/hash/cell sources

- `library/atto.core/math.atto` is a closed-world, pure integer source
  namespace. New additive `compileOwnedCoreMath` compiles the verified
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

## Namespace-based Atto library form

The compiled JS math `.atto` file now declares `use namespace atto.core.math;`
followed by public top-level functions, **without** `define module math`.
`compileOwnedCoreMath` accepts only that exact namespace, validates the
parsed program-v2 IR, and adapts its exports to the existing frozen `math`
ESM API through a second checked IR validation pass. The namespace is
static source metadata, not runtime package authority. No arbitrary
namespace import, module graph, host capability or implicit `alloc/std`
service is admitted; JS hash/cell imports remain unsupported.

The general parser and validator now accept bounded dotted file namespace
headers in the canonical `use namespace a.b.c;` spelling. Repeated or late
headers and package-less import statements remain rejected. This is not
yet the full `import * as ... from pkg` conformance implementation.

The namespaced JS math adapter permits private top-level helpers while
requiring at least one public exported function. Validated symbol visibility
and arity are preserved by the checked typed IR; the ESM exports only public
members. Namespace metadata remains static and never imports a package.
