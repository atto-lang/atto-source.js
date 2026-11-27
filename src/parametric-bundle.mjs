// Compiler-owned resolved formal identities, not source or runtime objects.
// Defaults, expression inference and cross-formal constraints are caller duties.
function invalid(message) { throw new TypeError('E_PARAMETRIC_BUNDLE: ' + message); }
function schemaIndex(schema) {
  const index = new Map();
  for (const {name, accepts} of schema) {
    if (typeof name !== 'string' || !name || typeof accepts !== 'function' || index.has(name))
      invalid('invalid or duplicate formal');
    index.set(name, accepts);
  }
  return index;
}
function checked(index, entries) {
  const result = new Map();
  for (const [name, value] of entries) {
    if (!index.has(name) || result.has(name) || value == null || !index.get(name)(value))
      invalid('unknown, duplicate or invalid argument: ' + name);
    result.set(name, value);
  }
  return result;
}
function canonical(index, first, additional, refine) {
  const staged = new Map(first);
  for (const [name, value] of additional) {
    if (!refine && staged.has(name)) invalid('overlapping argument: ' + name);
    staged.set(name, value);
  }
  return Object.freeze([...index.keys()].filter(name => staged.has(name))
    .map(name => Object.freeze([name, staged.get(name)])));
}
export function bindBundle(schema, seed, additional, mode) {
  if (mode !== 'application' && mode !== 'refinement') invalid('invalid binding mode');
  const index = schemaIndex(schema);
  return canonical(index, checked(index, seed), checked(index, additional), mode === 'refinement');
}
export function refineInferred(schema, seed, replacements, holes, evidence) {
  const index = schemaIndex(schema);
  const base = checked(index, seed), explicit = checked(index, replacements), observed = checked(index, evidence);
  const requested = new Set();
  for (const hole of holes) {
    if (requested.has(hole) || !base.has(hole) || explicit.has(hole)) invalid('invalid inherited inference hole: ' + hole);
    requested.add(hole);
  }
  if (requested.size !== observed.size || [...observed.keys()].some(name => !requested.has(name)))
    invalid('missing or unexpected evidence');
  return canonical(index, base, new Map([...explicit, ...observed]), true);
}
