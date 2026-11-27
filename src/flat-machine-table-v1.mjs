// Compiler-owned metadata only. Not a guest parser, nominal event identity,
// actor scheduler, serialization boundary or authority to publish state.
const LIMIT = 256;
const require = (condition) => {
  if (!condition) throw new TypeError('E_MACHINE_TABLE');
};
const validName = (name) => typeof name === 'string' && name.length <= 1024
  && /^[A-Za-z_][A-Za-z_0-9]*$/.test(name) && !/[\r\n]/.test(name);

export function verifyFlatMachineTable(initial, nodes) {
  require(Array.isArray(nodes) && nodes.length > 0 && nodes.length <= LIMIT);
  require(Number.isInteger(initial) && initial >= 0 && initial < nodes.length);
  const names = [], events = new Set(), graph = [];
  let count = 0;
  for (const node of nodes) {
    require(node && validName(node.name) && typeof node.terminal === 'boolean');
    require(names.length === 0 || names.at(-1) < node.name);
    require(Array.isArray(node.edges) && node.edges.length <= LIMIT - count);
    require(!node.terminal || node.edges.length === 0);
    names.push(node.name);
    const row = [];
    let previous = '';
    for (const edge of node.edges) {
      require(edge && validName(edge.event) && previous < edge.event);
      require(Number.isInteger(edge.target) && edge.target >= 0 && edge.target < nodes.length);
      ++count;
      events.add(edge.event);
      row.push([edge.event, edge.target]);
      previous = edge.event;
    }
    graph.push(row);
  }
  const seen = new Set(), pending = [initial];
  while (pending.length) {
    const node = pending.pop();
    if (seen.has(node)) continue;
    seen.add(node);
    for (const [, target] of graph[node]) pending.push(target);
  }
  require(seen.size === names.length);
  const ordered = [...events].sort(); // ASCII order matches C++ table profile.
  const slots = new Map(ordered.map((event, i) => [event, i]));
  const rows = graph.map((row) => row.map(([event, target]) => [slots.get(event), target]));
  return Object.freeze({
    initial,
    names: Object.freeze(names),
    events: Object.freeze(ordered),
    successor(node, slot) {
      require(Number.isInteger(node) && node >= 0 && node < rows.length);
      require(Number.isInteger(slot) && slot >= 0 && slot < ordered.length);
      const edge = rows[node].find(([id]) => id === slot);
      return edge === undefined ? null : edge[1];
    },
  });
}
