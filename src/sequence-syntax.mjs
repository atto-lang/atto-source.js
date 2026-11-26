// Comma ownership for the scalar parser. The parser supplies expression parsing
// and diagnostics; this module never evaluates or discards guest expressions.
export function startsBareSequence(parser) {
  return parser.peek().kind === 'id' && parser.peek().value === 'seq' &&
    parser.ts[parser.pos + 1]?.value !== '(';
}

export function readSequence(parser, grouped, fail) {
  const items = [];
  do {
    if (items.length >= 128) fail('sequence item limit', parser.peek());
    if ([',', ')', ';', '}', 'end', '<eof>'].includes(parser.peek().value))
      fail('E_SEQ_COMMA: missing sequence expression', parser.peek());
    items.push(parser.expr());
  } while (parser.match(','));
  if (grouped) parser.expect(')');
  return {kind: 'seq', items};
}

// Opening '(' has already been consumed. A bare sequence owns every
// remaining comma in this argument list; grouped seq is an ordinary argument.
export function readCallArguments(parser, fail) {
  const args = [];
  if (parser.match(')')) return args;
  do {
    if (args.length >= 128) fail('argument limit', parser.peek());
    if (startsBareSequence(parser)) {
      parser.pos++;
      args.push(readSequence(parser, false, fail));
      parser.expect(')');
      return args;
    }
    args.push(parser.expr());
  } while (parser.match(','));
  parser.expect(')');
  return args;
}
