# JS hosted `std/time` boundary — implementation status

This backend maintains its own `stdlib/std/time.atto` source independently of
other Atto compilers. **The current JS scalar compiler does not yet import,
type-check, link or execute this class-based module.** That path must fail
closed; a green Node host-adapter test is **not** evidence of compiled guest
`.atto` conformance.

The separate, importable host adapter `./src/std-time-runtime.mjs` implements:
- Checked unsigned-nonnegative **signed-64-range** nanosecond values as
  JavaScript `bigint`; refusing JS Number prevents lossy conversion.
- Checked unit conversions and add/subtract/multiply up to
  `9223372036854775807` nanoseconds.
- A host-constructed monotonic clock with never-early timer completion,
  spurious wakeup re-arming, zero-delay event-loop yielding, deadline
  overflow checks and fail-closed clock-regression detection.
- Per-scheduler bounded registration (default 64), AbortSignal cancellation
  and exactly-once pending-slot reclamation. The caller controls trusted host
  callbacks; these are not exposed to untrusted Atto guest code.
- SetTimeout integer delay clamping for durations greater than the host
  maximum; logical deadlines remain in full-precision nanoseconds.

**Never** reinterpret these exported JS functions as guest `std/time`
functions, promise an actor suspension guarantee from host Node timers or
use arbitrary `clock_id` data as a privileged clock-provenance capability.

## Executable test and evidence

`npm run test:std-time` exercises checked arithmetic, queue lifecycle,
early/spurious wakeups, abort, capacity, invalid/nonmonotonic clocks, deadline
overflow, sync scheduler misuse and a **real JS compiler** negative admission
test for the full Atto class module and `import module time from "std/time"`.

Before claiming full parity, add a trusted compile/link importer, lower guest
`Duration`/`Instant` and `sleep` to scheduler-owned intrinsics, run a
positive compiled Atto fixture, and prove AOT/browser-worker behavior. The
public Atto API remains aspirational until then.
