// Fail-closed source HTTP actor admission shared by the JS scalar and program-v2 frontends.
// An optional HTTP host adapter does not give the compiler actor-local request,
// ownership, cancellation or physical-shutdown lowering. Inspect lexer tokens,
// never raw source substrings: comments and quoted text are not declarations.
const HTTP_ACTOR_MODIFIERS = new Set([
  'pub', 'private', 'shared', 'untrusted', 'serial', 'http', 'tcp',
  'websocket', 'ws', 'stream', 'unary', 'abstract'
]);

export function rejectUnsupportedHttpActors(tokens, reject) {
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].kind !== 'id' || tokens[i].value !== 'define') continue;
    let j = i + 1;
    let hasHttp = false;
    // A token is consumed at most once per encountered declaration. The
    // frontend already enforces a finite token budget before invoking us.
    while (tokens[j]?.kind === 'id' &&
           HTTP_ACTOR_MODIFIERS.has(tokens[j].value)) {
      if (tokens[j].value === 'http') hasHttp = true;
      j++;
    }
    if (hasHttp && tokens[j]?.kind === 'id' &&
        (tokens[j].value === 'actor' || tokens[j].value === 'isoactor')) {
      reject(
        'HTTP_ACTOR_BACKEND_UNSUPPORTED: JS backend cannot lower source HTTP actor request/mail lifetimes, guarded state, or physical shutdown',
        tokens[j]
      );
    }
  }
}
