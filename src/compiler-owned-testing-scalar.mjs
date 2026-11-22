// Browser-safe compiler-owned library snapshot generated from this compiler's
// own stdlib/testing_scalar.atto. No runtime filesystem or network resolution.
// The exact-byte mirror is checked by tests/testing-scalar-import.test.mjs.
export const TESTING_SCALAR_SOURCE = "// JavaScript backend-local AttoLang scalar test assertions, M0.\n// Public behavior matches the LLVM scalar status contract: 0 pass, 1 fail.\n// This is a compiler-local .atto source module CANDIDATE, not yet wired\n// into implicit std/testing imports or a full TestSuite/ORESTEST runner.\npub fnc equal_int(int actual, int expected): int {\n  return actual == expected ? 0 : 1;\n}\n\npub fnc not_equal_int(int actual, int unexpected): int {\n  return actual != unexpected ? 0 : 1;\n}\n\npub fnc greater_than_int(int actual, int lower_bound): int {\n  return actual > lower_bound ? 0 : 1;\n}\n\npub fnc less_than_int(int actual, int upper_bound): int {\n  return actual < upper_bound ? 0 : 1;\n}\n\npub fnc in_range_int(int actual, int lower_bound, int upper_bound): int {\n  return lower_bound > upper_bound ? 1 : (actual < lower_bound ? 1 : (actual > upper_bound ? 1 : 0));\n}\n\npub fnc combine_status(int first, int second): int {\n  return first != 0 ? 1 : (second != 0 ? 1 : 0);\n}\n";
export const TESTING_SCALAR_EXPORTS = Object.freeze([
  'equal_int', 'not_equal_int', 'greater_than_int',
  'less_than_int', 'in_range_int', 'combine_status'
]);
