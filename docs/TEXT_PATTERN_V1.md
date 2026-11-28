# Pattern-based text parsing v1

Status: **draft, first executable slice** (JS backend runtime library).
Feature 12 of the 15 proposals.

## Problem

Host regex engines (JS, Java, .NET, PCRE) backtrack, so `(a+)+$` on a long
non-matching input takes exponential time (ReDoS). Their dialects also differ,
so the same AttoLang pattern would behave differently per backend.

## Shipped: `src/text-pattern-v1.mjs`

### `compilePattern(source)`: linear-time regex
* Compiled to a Thompson NFA and run on a **Pike VM over Unicode code points**.
  Time is O(input × program), for every input.
* Leftmost-first (Perl-style) priority for alternation, greedy and lazy
  quantifiers, and capture groups. A corpus test agrees with host `RegExp`
  on safe patterns.
* Syntax: literals, `.`, `[...]`/`[^...]` with ranges, `\d \w \s \D \W \S`,
  escapes, `^ $`, `(...)`, `(?:...)`, `|`, `* + ? {m} {m,} {m,n}` and lazy forms.
* **Fail closed** (`PatternError.code`):
  * `E_PATTERN_UNSUPPORTED`: backreferences, lookaround, named groups and
    `\b`. These cannot be matched in linear time, or are not in v1.
  * `E_PATTERN_SYNTAX`: unbalanced groups, dangling quantifiers, reversed
    ranges, unknown escapes, repeated anchors.
  * `E_PATTERN_BUDGET`: source over 4096 chars, a repeat bound over 1000,
    or a compiled program over 20k instructions (`(a{1000}){1000}` is rejected,
    not allocated).
* API: `match(input, from)`, `matchAt(input, pos)` (anchored), `test`,
  `fullMatch`, `matchAll` (empty matches advance), plus `groupCount` and
  `programSize`.

### `P` parser combinators
`lit`, `re`, `seq`, `alt`, `many`, `opt`, `sepBy`, `map`, `lazy`, `eof`, and
`parse(parser, input)`.
* Errors report the **furthest failure**, with line, column and the full
  expected set. A success remembers the failure it recovered from (e.g.
  `sepBy` stopping at a missing `,`), so messages read `expected "," or "]"`
  rather than just `"]"`.
* `many` stops on zero-width progress, so `many(re('x*'))` cannot hang.

## Tests: `tests/text-pattern-v1.test.mjs` (8 cases)
Five classic ReDoS patterns on 20k-char hostile inputs, priority and
captures, a host-RegExp agreement corpus, anchors and `matchAll`, non-BMP
code points, the fail-closed matrix, a full JSON-subset parser built from
combinators, error position and expected set, and zero-width `many`.

## Proposed AttoLang surface (for spec review)

```atto
val Pattern phone = pattern"(\d{3})-(\d{4})";   // compiled at build time; errors are compile errors
match phone.find(text) {
  Some(m) => use(m.group(1)),
  None => ...
}
```

Pattern literals compile at build time (an AOT-safe program table, no runtime
regex compiler), so a bad pattern is a compile-time diagnostic with the same
codes.

## Next slices
1. Share the VM program format with rs/Java/LLVM and add a conformance corpus.
2. A `pattern"..."` literal in the parsers, compiled ahead of time.
3. Case-insensitive flag, Unicode property classes (`\p{L}`), a one-pass DFA
   cache for hot patterns.
