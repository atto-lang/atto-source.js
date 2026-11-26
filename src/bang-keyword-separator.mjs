// Lexical separator admission only: no ownership or exceptional lowering.
const WORDS = new Set(['trap','throw','raise','panic','copy','take','move','borrow','share','pin','drop','pipe','rpipe','stop','expand']);
export function missingBangKeywordSeparator(word, tail) {
  if (!WORDS.has(word) || tail[0] !== '!' || tail[1] === '=' ||
      /^!eq(?![\p{L}\p{N}_])/u.test(tail)) return false;
  const after = word === 'copy' && tail[1] === '!' ? 2 : 1;
  return !/[ \t\r\n\v\f]/.test(tail[after] ?? '');
}
