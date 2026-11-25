// Lexical string/template boundary shared by the JS scalar frontend.
// This recognizes source syntax but does not claim typed String or template
// expression lowering in the i64-only backend.
export function scanStringLiteral(source, start = 0) {
  if (typeof source !== 'string' || !Number.isInteger(start) || start < 0 ||
      start >= source.length || !["'", '"', '`'].includes(source[start])) {
    throw new SyntaxError('expected quote at offset ' + start);
  }
  if (source.length > 262144) throw new SyntaxError('source budget exceeded');
  const fail = (message, at) => { throw new SyntaxError(message + ' at offset ' + at); };
  const isLine = ch => ch === '\n' || ch === '\r' || ch === '\u0085' ||
    ch === '\u2028' || ch === '\u2029';
  const hex = ch => ch !== undefined && /^[0-9a-fA-F]$/.test(ch);
  let substitutions = 0;
  function scanQuoted(at, depth) {
    if (depth > 32) fail('string/template nesting limit', at);
    const quote = source[at];
    let i = at + 1;
    let textStart = i;
    const parts = [];
    while (i < source.length) {
      const ch = source[i];
      if (ch === '\\') {
        const atEscape = i;
        i++;
        if (i >= source.length) fail('unterminated escape', atEscape);
        const next = source[i];
        if (isLine(next)) {
          if (quote === '`') fail('invalid template escape', atEscape);
          if (next === '\r' && source[i+1] === '\n') i++;
          i++;
          continue;
        }
        if (next === 'u') {
          i++;
          if (![0,1,2,3].every(n => hex(source[i+n])))
            fail('invalid Unicode escape', atEscape);
          const scalar = Number.parseInt(source.slice(i,i+4),16);
          i += 4;
          if (scalar >= 0xd800 && scalar <= 0xdbff) {
            // Java's decoded String contract admits valid surrogate pairs,
            // never a lone surrogate across literal/interpolation boundaries.
            if (source.slice(i,i+2) !== '\\u' ||
                ![0,1,2,3].every(n => hex(source[i+2+n])) ||
                Number.parseInt(source.slice(i+2,i+6),16) < 0xdc00 ||
                Number.parseInt(source.slice(i+2,i+6),16) > 0xdfff)
              fail('invalid Unicode escape', atEscape);
            i += 6;
          } else if (scalar >= 0xdc00 && scalar <= 0xdfff) {
            fail('invalid Unicode escape', atEscape);
          }
          continue;
        }
        // A backslash must not hide an isolated raw UTF-16 surrogate from
        // direct scanner callers. Paired code units remain one raw scalar.
        const escapedCode = source.charCodeAt(i);
        if (escapedCode >= 0xd800 && escapedCode <= 0xdbff) {
          const low = source.charCodeAt(i+1);
          if (!(low >= 0xdc00 && low <= 0xdfff))
            fail('unpaired Unicode surrogate in string', i);
          if (quote === '`') fail('invalid template escape', atEscape);
          i += 2;
          continue;
        }
        if (escapedCode >= 0xdc00 && escapedCode <= 0xdfff)
          fail('unpaired Unicode surrogate in string', i);
        // Ordinary quotes preserve Java's legacy escaped-character fallback.
        // Backtick templates have a deliberately strict escape whitelist.
        if (quote === '`' && !"\\'\"`$nrt".includes(next))
          fail('invalid template escape', atEscape);
        i++;
        continue;
      }
      if (ch === quote) {
        parts.push({kind:'text',raw:source.slice(textStart,i),start:textStart,end:i});
        return {kind: quote === '`' ? 'template' : 'string',
          quote, start:at, end:i+1, raw:source.slice(at,i+1), parts};
      }
      // Independently reject isolated raw UTF-16 surrogates, as the
      // compiler-level validator does for all source text.
      const code = source.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        const low = source.charCodeAt(i+1);
        if (!(low >= 0xdc00 && low <= 0xdfff))
          fail('unpaired Unicode surrogate in string', i);
        i += 2;
        continue;
      }
      if (code >= 0xdc00 && code <= 0xdfff)
        fail('unpaired Unicode surrogate in string', i);
      // Ordinary Java/Graal quoted strings preserve raw newlines; templates do too.
      if (quote === '`' && ch === '$' && source[i+1] === '{') {
        if (++substitutions > 1024) fail('template substitution limit', i);
        parts.push({kind:'text',raw:source.slice(textStart,i),start:textStart,end:i});
        const interpolationStart = i;
        const bodyStart = i + 2;
        const end = scanInterpolation(bodyStart, depth+1);
        const body = source.slice(bodyStart,end-1);
        if (!/[^\s\u0085]/.test(body)) fail('empty template interpolation', interpolationStart);
        parts.push({kind:'interpolation',source:body,start:interpolationStart,end});
        i = end;
        textStart = i;
        continue;
      }
      i++;
    }
    fail('unterminated string/template', at);
  }
  function scanInterpolation(at, depth) {
    if (depth > 32) fail('template nesting limit', at);
    let i=at, braces=1, hasCode=false;
    while (i < source.length) {
      if (source.startsWith('//',i)) {
        i+=2;
        while (i < source.length && !isLine(source[i])) i++;
        continue;
      }
      if (source.startsWith('/*',i)) {
        const commentStart = i;
        i += 2;
        let nested = 1;
        while (nested && i < source.length) {
          if (source.startsWith('/*',i)) {
            if (++nested > 128) fail('comment nesting limit',i);
            i += 2;
          } else if (source.startsWith('*/',i)) { nested--;i+=2; }
          else i++;
        }
        if (nested) fail('unterminated interpolation comment', commentStart);
        continue;
      }
      if (["'",'"','`'].includes(source[i])) {
        hasCode = true;
        i = scanQuoted(i,depth+1).end;
        continue;
      }
      if (source[i] === '{') {
        hasCode = true;
        if (++braces > 256) fail('interpolation brace nesting limit',i);
      } else if (source[i] === '}') {
        if (--braces === 0) {
          if (!hasCode) fail('empty template interpolation',at-2);
          return i+1;
        }
        hasCode = true;
      } else if (source[i] !== '\u0085' && !/\s/.test(source[i])) {
        hasCode = true;
      }
      i++;
    }
    fail('unterminated template interpolation',at-2);
  }
  return scanQuoted(start,0);
}
