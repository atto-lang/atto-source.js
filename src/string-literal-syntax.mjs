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
    if (depth > 64) fail('string/template nesting limit', at);
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
          if (next === '\r' && source[i+1] === '\n') i++;
          i++;
          continue;
        }
        if (next === 'u') {
          i++;
          if (source[i] === '{') {
            const digitStart = ++i;
            while (hex(source[i]) && i - digitStart < 7) i++;
            const digits = source.slice(digitStart, i);
            if (!digits.length || digits.length > 6 || source[i] !== '}' ||
                Number.parseInt(digits, 16) > 0x10ffff ||
                (Number.parseInt(digits, 16) >= 0xd800 &&
                 Number.parseInt(digits, 16) <= 0xdfff)) {
              fail('invalid Unicode escape', atEscape);
            }
            i++;
          } else {
            if (![0,1,2,3].every(n => hex(source[i+n])))
              fail('invalid Unicode escape', atEscape);
            const scalar = Number.parseInt(source.slice(i,i+4), 16);
            if (scalar >= 0xd800 && scalar <= 0xdfff)
              fail('invalid Unicode escape', atEscape);
            i += 4;
          }
          continue;
        }
        if (next === 'x') {
          if (!hex(source[i+1]) || !hex(source[i+2]))
            fail('invalid hex escape', atEscape);
          i += 3;
          continue;
        }
        if (!"\\'\"`$0bfnrtv".includes(next))
          fail('invalid string escape', atEscape);
        i++;
        continue;
      }
      if (ch === quote) {
        parts.push({kind:'text',raw:source.slice(textStart,i),start:textStart,end:i});
        return {kind: quote === '`' ? 'template' : 'string',
          quote, start:at, end:i+1, raw:source.slice(at,i+1), parts};
      }
      if (quote !== '`' && isLine(ch)) fail('newline in quoted string', i);
      if (quote === '`' && ch === '$' && source[i+1] === '{') {
        if (++substitutions > 128) fail('template substitution limit', i);
        parts.push({kind:'text',raw:source.slice(textStart,i),start:textStart,end:i});
        const interpolationStart = i;
        const bodyStart = i + 2;
        const end = scanInterpolation(bodyStart, depth+1);
        const body = source.slice(bodyStart,end-1);
        if (!body.trim()) fail('empty template interpolation', interpolationStart);
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
    if (depth > 64) fail('template nesting limit', at);
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
            if (++nested > 64) fail('comment nesting limit',i);
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
        if (++braces > 128) fail('interpolation brace nesting limit',i);
      } else if (source[i] === '}') {
        if (--braces === 0) {
          if (!hasCode) fail('empty template interpolation',at-2);
          return i+1;
        }
        hasCode = true;
      } else if (!/\s/.test(source[i])) {
        hasCode = true;
      }
      i++;
    }
    fail('unterminated template interpolation',at-2);
  }
  return scanQuoted(start,0);
}
