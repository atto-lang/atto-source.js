import { verifyFlatMachineTable } from '../src/flat-machine-table-v1.mjs';

// Test-only reference for compiler-owned plain metadata. No worker delivery,
// untrusted object admission, nominal type authority or runtime integration.
const MAX = (1n << 63n) - 1n;
const MIN = -(1n << 63n);
const i64 = x => typeof x === 'bigint' && x >= MIN && x <= MAX;
const require = ok => { if (!ok) throw new TypeError('E_MACHINE_PLAN'); };
const key = (node, event) => node * 256 + event;

export function scalarMachine(initialNode, nodes, operations, initial, limit = MAX) {
    require(i64(initial) && initial >= 0n && i64(limit) && limit >= 1n);
    const table = verifyFlatMachineTable(initialNode, nodes);
    const terminal = nodes.map(n => n.terminal);
    const count = nodes.reduce((sum, n) => sum + n.edges.length, 0);
    require(Array.isArray(operations) && operations.length === count);
    const deltas = new Map();
    for (const op of operations) {
        require(op && Number.isInteger(op.node) && op.node >= 0 && op.node < table.names.length);
        require(Number.isInteger(op.event) && op.event >= 0 && op.event < table.events.length);
        require(i64(op.delta) && table.successor(op.node, op.event) !== null);
        const id = key(op.node, op.event);
        require(!deltas.has(id));
        deltas.set(id, op.delta);
    }
    let current = Object.freeze({ node: initialNode, value: initial, version: 0n, generation: 1n });
    return Object.freeze({
        snapshot: () => current,
        // Single synchronous JS turn; not a thread-safe worker/mailbox protocol.
        apply(version, generation, event, cancelled = false) {
            require(i64(version) && i64(generation) && typeof cancelled === 'boolean');
            const old = current;
            if (version !== old.version || generation !== old.generation) return 'STALE';
            if (terminal[old.node]) return 'TERMINAL';
            if (!Number.isInteger(event) || event < 0 || event >= table.events.length) return 'INVALID_EVENT';
            const next = table.successor(old.node, event);
            if (next === null) return 'NO_EDGE';
            if (cancelled) return 'CANCELLED';
            if (old.version >= limit || old.generation >= limit) return 'EXHAUSTED';
            const value = old.value + deltas.get(key(old.node, event));
            if (!i64(value)) return 'OVERFLOW';
            if (value < 0n) return 'INVARIANT';
            current = Object.freeze({ node: next, value, version: old.version + 1n, generation: old.generation + 1n });
            return 'COMMITTED';
        },
    });
}
