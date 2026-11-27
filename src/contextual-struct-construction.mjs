// Bounded attached-struct construction: select a declared fieldwise constructor.
// Inputs are compiler-owned nominal metadata and typed expression code, not source text.
export function planContextualMake(owner, entries) {
  const fail = message => { throw new Error('E_ATTACHED_STRUCT: ' + message); };
  if (!owner || !Array.isArray(owner.fields) || !Array.isArray(owner.ctors)) fail('missing expected nominal owner');
  if (entries.length !== owner.fields.length) fail('incomplete fieldwise initialization');
  const positions = new Map();
  for (const [index, entry] of entries.entries()) {
    const field = owner.fields.find(f => f.name === entry.name);
    if (!field || positions.has(entry.name) || field.type !== entry.type) fail('invalid contextual field initializer');
    positions.set(entry.name, index);
  }
  const candidates = [];
  for (const ctor of owner.ctors) {
    if (!Array.isArray(ctor.fieldParams) || ctor.formals.length !== entries.length || ctor.fieldParams.length !== owner.fields.length) continue;
    const order = Array(ctor.formals.length).fill(-1);
    let valid = true;
    for (const [index, field] of owner.fields.entries()) {
      const slot = ctor.fieldParams[index];
      if (!Number.isInteger(slot) || slot < 0 || slot >= order.length || order[slot] !== -1 || ctor.formals[slot].type !== field.type) { valid = false; break; }
      order[slot] = positions.get(field.name);
    }
    if (valid && order.every(i => i >= 0)) candidates.push({ id: ctor.id, order });
  }
  if (candidates.length !== 1) fail('missing or ambiguous fieldwise constructor');
  return candidates[0];
}
