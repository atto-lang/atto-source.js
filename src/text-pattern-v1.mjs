// Pattern-based text parsing v1: a linear-time regular-expression engine
// (Pike VM over Unicode code points) plus small parser combinators.
//
// Why not host RegExp? JS (and Java/.NET) regexes backtrack: nested
// quantifiers such as (a+)+$ take exponential time on hostile input
// (ReDoS). AttoLang patterns are compiled to a Thompson NFA and simulated
// with a Pike VM: O(input × program) time, O(program) space per step,
// on every backend, with identical leftmost-first (Perl-style priority)
// capture semantics. Features that cannot be matched in linear time
// (backreferences, lookaround) are rejected at compile time, not
// approximated.
//
// Supported syntax: literals, '.', [...] / [^...] with ranges, \d \w \s
// \D \W \S, escapes \n \t \r \\ \. etc., anchors ^ $, groups (...) and
// (?:...), alternation |, quantifiers * + ? {m} {m,} {m,n} and lazy *? +?
// ?? {m,n}?. Counted repetition is bounded so the program stays bounded.

export class PatternError extends Error {
  constructor(code, message, index) {
    super(`${code}: ${message}${index === undefined ? '' : ` at ${index}`}`);
    this.code = code;
    this.index = index;
  }
}

const MAX_SOURCE = 4096;
const MAX_REPEAT = 1000;
const DEFAULT_MAX_PROGRAM = 20000;

const isDigit = (c) => c >= 48 && c <= 57;
const isWord = (c) => isDigit(c) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
const isSpace = (c) => c === 32 || (c >= 9 && c <= 13) || c === 0xa0 || c === 0x2028 || c === 0x2029 || c === 0xfeff;

// ---------- parser: pattern source -> AST ----------
function parseSource(src) {
  if (typeof src !== 'string') throw new PatternError('E_PATTERN_SYNTAX', 'pattern must be a string');
  if (src.length > MAX_SOURCE) throw new PatternError('E_PATTERN_BUDGET', `pattern exceeds ${MAX_SOURCE} chars`);
  const cps = Array.from(src, (s) => s.codePointAt(0));
  let i = 0;
  let groups = 0;
  const peek = () => cps[i];
  const fail = (code, msg) => { throw new PatternError(code, msg, i); };

  function escapeClass(c) {
    switch (c) {
      case 100: return { pred: isDigit }; // d
      case 68: return { pred: (x) => !isDigit(x) };
      case 119: return { pred: isWord }; // w
      case 87: return { pred: (x) => !isWord(x) };
      case 115: return { pred: isSpace }; // s
      case 83: return { pred: (x) => !isSpace(x) };
      default: return null;
    }
  }
  function escapeLiteral(c) {
    switch (c) {
      case 110: return 10; case 116: return 9; case 114: return 13; case 102: return 12; case 118: return 11; case 48: return 0;
      default:
        if (c >= 49 && c <= 57) fail('E_PATTERN_UNSUPPORTED', 'backreferences cannot be matched in linear time');
        if (c === 98 || c === 66) fail('E_PATTERN_UNSUPPORTED', 'word-boundary assertions are not in v1');
        if (isWord(c)) fail('E_PATTERN_SYNTAX', `unknown escape \\${String.fromCodePoint(c)}`);
        return c;
    }
  }
  function parseClass() {
    i++; // [
    let negate = false;
    if (peek() === 94) { negate = true; i++; }
    const items = [];
    let first = true;
    while (i < cps.length && (peek() !== 93 || first)) {
      first = false;
      let c = cps[i++];
      if (c === 92) {
        const e = cps[i++];
        if (e === undefined) fail('E_PATTERN_SYNTAX', 'dangling escape in class');
        const cls = escapeClass(e);
        if (cls) { items.push(cls.pred); continue; }
        c = escapeLiteral(e);
      }
      if (peek() === 45 && cps[i + 1] !== undefined && cps[i + 1] !== 93) {
        i++;
        let hi = cps[i++];
        if (hi === 92) hi = escapeLiteral(cps[i++]);
        if (hi < c) fail('E_PATTERN_SYNTAX', 'reversed class range');
        const lo = c;
        items.push((x) => x >= lo && x <= hi);
      } else {
        const lit = c;
        items.push((x) => x === lit);
      }
    }
    if (peek() !== 93) fail('E_PATTERN_SYNTAX', 'unterminated character class');
    i++;
    return { type: 'char', pred: (x) => items.some((p) => p(x)) !== negate };
  }
  function parseAtom() {
    const c = peek();
    if (c === 40) { // (
      i++;
      let capture = true;
      if (peek() === 63) { // ?
        if (cps[i + 1] === 58) { capture = false; i += 2; }
        else fail('E_PATTERN_UNSUPPORTED', 'lookaround and named/flag groups are not linear-time v1 features');
      }
      const index = capture ? ++groups : 0;
      const body = parseAlt();
      if (peek() !== 41) fail('E_PATTERN_SYNTAX', 'unbalanced parenthesis');
      i++;
      return capture ? { type: 'group', index, body } : body;
    }
    if (c === 91) return parseClass();
    if (c === 46) { i++; return { type: 'char', pred: (x) => x !== 10 && x !== 13 } }
    if (c === 94) { i++; return { type: 'bol' }; }
    if (c === 36) { i++; return { type: 'eol' }; }
    if (c === 92) {
      i++;
      const e = cps[i++];
      if (e === undefined) fail('E_PATTERN_SYNTAX', 'dangling escape');
      const cls = escapeClass(e);
      if (cls) return { type: 'char', pred: cls.pred };
      const lit = escapeLiteral(e);
      return { type: 'char', pred: (x) => x === lit };
    }
    if (c === 41 || c === 124 || c === undefined) fail('E_PATTERN_SYNTAX', 'expected an expression');
    if (c === 42 || c === 43 || c === 63 || c === 123) fail('E_PATTERN_SYNTAX', 'quantifier without a target');
    i++;
    return { type: 'char', pred: (x) => x === c };
  }
  function readInt() {
    const start = i;
    while (isDigit(peek() ?? -1)) i++;
    if (start === i) return null;
    const n = Number(String.fromCodePoint(...cps.slice(start, i)));
    if (n > MAX_REPEAT) fail('E_PATTERN_BUDGET', `repetition bound exceeds ${MAX_REPEAT}`);
    return n;
  }
  function parseRepeat() {
    let atom = parseAtom();
    for (;;) {
      const c = peek();
      let min, max;
      if (c === 42) { min = 0; max = Infinity; i++; }
      else if (c === 43) { min = 1; max = Infinity; i++; }
      else if (c === 63) { min = 0; max = 1; i++; }
      else if (c === 123) {
        const save = i;
        i++;
        const lo = readInt();
        if (lo === null) { i = save; return atom; }
        let hi = lo;
        if (peek() === 44) { i++; hi = readInt() ?? Infinity; }
        if (peek() !== 125) fail('E_PATTERN_SYNTAX', 'unterminated {m,n}');
        i++;
        if (hi < lo) fail('E_PATTERN_SYNTAX', '{m,n} with n < m');
        min = lo; max = hi;
      } else return atom;
      if (atom.type === 'bol' || atom.type === 'eol') fail('E_PATTERN_SYNTAX', 'cannot repeat an anchor');
      let lazy = false;
      if (peek() === 63) { lazy = true; i++; }
      atom = { type: 'repeat', body: atom, min, max, lazy };
    }
  }
  function parseConcat() {
    const items = [];
    while (i < cps.length && peek() !== 124 && peek() !== 41) items.push(parseRepeat());
    return { type: 'concat', items };
  }
  function parseAlt() {
    const options = [parseConcat()];
    while (peek() === 124) { i++; options.push(parseConcat()); }
    return options.length === 1 ? options[0] : { type: 'alt', options };
  }
  const ast = parseAlt();
  if (i !== cps.length) fail('E_PATTERN_SYNTAX', 'unbalanced parenthesis');
  return { ast, groups };
}

// ---------- compiler: AST -> Pike VM program ----------
function compile(ast, maxProgram) {
  const prog = [];
  const emit = (ins) => {
    if (prog.length >= maxProgram) throw new PatternError('E_PATTERN_BUDGET', `compiled program exceeds ${maxProgram} instructions`);
    prog.push(ins);
    return prog.length - 1;
  };
  function gen(n) {
    switch (n.type) {
      case 'char': emit({ op: 'char', pred: n.pred }); return;
      case 'bol': emit({ op: 'bol' }); return;
      case 'eol': emit({ op: 'eol' }); return;
      case 'concat': for (const x of n.items) gen(x); return;
      case 'group':
        emit({ op: 'save', slot: 2 * n.index });
        gen(n.body);
        emit({ op: 'save', slot: 2 * n.index + 1 });
        return;
      case 'alt': {
        const jumps = [];
        n.options.forEach((opt, k) => {
          if (k < n.options.length - 1) {
            const split = emit({ op: 'split', x: 0, y: 0 });
            prog[split].x = prog.length;
            gen(opt);
            jumps.push(emit({ op: 'jmp', to: 0 }));
            prog[split].y = prog.length;
          } else gen(opt);
        });
        for (const j of jumps) prog[j].to = prog.length;
        return;
      }
      case 'repeat': {
        for (let k = 0; k < n.min; k++) gen(n.body);
        if (n.max === Infinity) {
          const split = emit({ op: 'split', x: 0, y: 0 });
          const bodyStart = prog.length;
          gen(n.body);
          emit({ op: 'jmp', to: split });
          const after = prog.length;
          Object.assign(prog[split], n.lazy ? { x: after, y: bodyStart } : { x: bodyStart, y: after });
        } else {
          const splits = [];
          for (let k = n.min; k < n.max; k++) {
            const split = emit({ op: 'split', x: 0, y: 0 });
            splits.push(split);
            prog[split].body = prog.length;
            gen(n.body);
          }
          const after = prog.length;
          for (const s of splits) Object.assign(prog[s], n.lazy ? { x: after, y: prog[s].body } : { x: prog[s].body, y: after });
        }
        return;
      }
      default: throw new PatternError('E_PATTERN_SYNTAX', `unknown node ${n.type}`);
    }
  }
  emit({ op: 'save', slot: 0 });
  gen(ast);
  emit({ op: 'save', slot: 1 });
  emit({ op: 'match' });
  return prog;
}

// ---------- Pike VM ----------
function run(prog, slotCount, input, startPos, anchored) {
  const len = input.length;
  let clist = [];
  let matched = null;
  let gen = 0;
  const mark = new Int32Array(prog.length).fill(-1);
  function add(list, pc, caps, pos) {
    // Iterative-safe recursion depth is bounded by program size.
    if (mark[pc] === gen) return;
    mark[pc] = gen;
    const ins = prog[pc];
    switch (ins.op) {
      case 'jmp': add(list, ins.to, caps, pos); return;
      case 'split': add(list, ins.x, caps, pos); add(list, ins.y, caps, pos); return;
      case 'save': {
        const next = caps.slice();
        next[ins.slot] = pos;
        add(list, pc + 1, next, pos);
        return;
      }
      case 'bol': if (pos === 0) add(list, pc + 1, caps, pos); return;
      case 'eol': if (pos === len) add(list, pc + 1, caps, pos); return;
      default: list.push({ pc, caps });
    }
  }
  let pos = startPos;
  gen++;
  add(clist, 0, new Array(slotCount).fill(-1), pos);
  for (;;) {
    const cp = pos < len ? input.codePointAt(pos) : -1;
    const width = cp > 0xffff ? 2 : 1;
    const nlist = [];
    gen++;
    for (const t of clist) {
      const ins = prog[t.pc];
      if (ins.op === 'match') { matched = t.caps; break; } // cut lower-priority threads
      if (ins.op === 'char' && cp >= 0 && ins.pred(cp)) add(nlist, t.pc + 1, t.caps, pos + width);
    }
    if (pos >= len) break;
    pos += width;
    if (!anchored && matched === null) {
      // Lowest priority: begin a fresh attempt at the new position.
      add(nlist, 0, new Array(slotCount).fill(-1), pos);
    }
    if (nlist.length === 0) break;
    clist = nlist;
  }
  if (matched === null) {
    // A trailing match thread may remain in the final list.
    for (const t of clist) if (prog[t.pc].op === 'match') { matched = t.caps; break; }
  }
  return matched;
}

function toResult(input, caps) {
  if (!caps) return null;
  const groups = [];
  for (let g = 1; 2 * g < caps.length; g++) {
    groups.push(caps[2 * g] >= 0 && caps[2 * g + 1] >= 0 ? input.slice(caps[2 * g], caps[2 * g + 1]) : undefined);
  }
  return { start: caps[0], end: caps[1], text: input.slice(caps[0], caps[1]), groups };
}

export function compilePattern(source, { maxProgram = DEFAULT_MAX_PROGRAM } = {}) {
  const { ast, groups } = parseSource(source);
  const prog = compile(ast, maxProgram);
  const slots = 2 * (groups + 1);
  return Object.freeze({
    source,
    groupCount: groups,
    programSize: prog.length,
    /** Leftmost match (leftmost-first priority among alternatives). */
    match(input, from = 0) {
      if (typeof input !== 'string') throw new TypeError('input must be a string');
      return toResult(input, run(prog, slots, input, from, false));
    },
    /** Match that must start exactly at `pos` (used by combinators). */
    matchAt(input, pos) {
      return toResult(input, run(prog, slots, input, pos, true));
    },
    test(input) { return this.match(input) !== null; },
    fullMatch(input) {
      const m = this.matchAt(input, 0);
      return m && m.end === input.length ? m : null;
    },
    *matchAll(input) {
      let from = 0;
      while (from <= input.length) {
        const m = this.match(input, from);
        if (!m) return;
        yield m;
        from = m.end > m.start ? m.end : m.end + 1;
      }
    },
  });
}

// ---------- parser combinators ----------
// A parser is (input, pos) -> {ok:true, value, pos} | {ok:false, pos, expected}.
// `parse` reports the furthest failure position with the set of expected
// tokens there, which gives "expected ',' or ']'"-quality messages.

// A success may carry `fail`: the furthest failure it recovered from (e.g.
// sepBy stopping at a missing separator). Sequencing merges it with the
// next failure so messages list every token that would have been valid.
const ok = (value, pos, fail = null) => ({ ok: true, value, pos, fail });
const no = (pos, expected) => ({ ok: false, pos, expected });

function furthest(a, b) {
  if (a.pos !== b.pos) return a.pos > b.pos ? a : b;
  return no(a.pos, [...new Set([...a.expected, ...b.expected])]);
}
const merge = (a, b) => (a && b ? furthest(a, b) : a ?? b ?? null);

export const P = Object.freeze({
  lit: (s) => (input, pos) => (input.startsWith(s, pos) ? ok(s, pos + s.length) : no(pos, [JSON.stringify(s)])),
  re: (source, label) => {
    const pat = compilePattern(source);
    const name = label ?? `/${source}/`;
    return (input, pos) => {
      const m = pat.matchAt(input, pos);
      return m ? ok(m.text, m.end) : no(pos, [name]);
    };
  },
  seq: (...parsers) => (input, pos) => {
    const values = [];
    let pending = null;
    for (const p of parsers) {
      const r = p(input, pos);
      if (!r.ok) return pending ? furthest(pending, r) : r;
      values.push(r.value);
      pending = r.pos === pos ? merge(pending, r.fail) : r.fail;
      pos = r.pos;
    }
    return ok(values, pos, pending);
  },
  alt: (...parsers) => (input, pos) => {
    let best = no(pos, []);
    for (const p of parsers) {
      const r = p(input, pos);
      if (r.ok) return r;
      best = furthest(best, r);
    }
    return best;
  },
  many: (p) => (input, pos) => {
    const values = [];
    for (;;) {
      const r = p(input, pos);
      if (!r.ok) return r.pos > pos ? r : ok(values, pos, r); // committed partial input is an error
      if (r.pos === pos) return ok(values, pos); // no progress: stop (prevents infinite loops)
      values.push(r.value);
      pos = r.pos;
    }
  },
  map: (p, f) => (input, pos) => {
    const r = p(input, pos);
    return r.ok ? ok(f(r.value), r.pos, r.fail) : r;
  },
  opt: (p, fallback = null) => (input, pos) => {
    const r = p(input, pos);
    return r.ok ? r : r.pos > pos ? r : ok(fallback, pos, r);
  },
  sepBy: (p, sep) => (input, pos) => {
    const first = p(input, pos);
    if (!first.ok) return first.pos > pos ? first : ok([], pos, first);
    const values = [first.value];
    pos = first.pos;
    for (;;) {
      const s = sep(input, pos);
      if (!s.ok) return ok(values, pos, s);
      const r = p(input, s.pos);
      if (!r.ok) return r;
      values.push(r.value);
      pos = r.pos;
    }
  },
  lazy: (thunk) => {
    let cached;
    return (input, pos) => (cached ??= thunk())(input, pos);
  },
  eof: (input, pos) => (pos === input.length ? ok(null, pos) : no(pos, ['end of input'])),
});

export function parse(parser, input) {
  const r = parser(input, 0);
  if (r.ok && r.pos === input.length) return { ok: true, value: r.value };
  const at = r.ok ? merge(r.fail?.pos === r.pos ? r.fail : null, no(r.pos, ['end of input'])) : r;
  const before = input.slice(0, at.pos);
  const line = before.split('\n').length;
  const col = at.pos - before.lastIndexOf('\n');
  return { ok: false, index: at.pos, line, col, expected: [...at.expected].sort() };
}
