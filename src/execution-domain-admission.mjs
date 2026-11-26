/**
 * Execution-domain admission shared by every JS source frontend.
 *
 * `cpu`, `gpu` and `quantum` are reserved execution-domain words (Java and
 * LLVM reject them as identifiers too). This backend lowers none of the
 * cpu/gpu/quantum regions or CPU/GPU Task forms, so each must fail with a
 * dedicated diagnostic before parsing. Never let one fall through to a
 * generic syntax error: a later grammar extension could then silently run a
 * device region as ordinary host code.
 *
 * Contract: oreslang-platform-conformance docs/CPU_GPU_TASK_V2.md.
 */
export const EXECUTION_DOMAIN_WORDS = Object.freeze(['cpu', 'gpu', 'quantum']);
const DOMAIN_WORDS = new Set(EXECUTION_DOMAIN_WORDS);

/**
 * @param {{kind:string,value:string}[]} tokens lexer output; identifiers have kind 'id'
 * @param {(message:string, token:object)=>never} fail frontend error reporter
 */
export function rejectExecutionDomains(tokens, fail) {
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.kind !== 'id') continue;
    const next = tokens[i + 1];
    const opensBlock = next?.kind === 'sym' && next.value === '{';
    if (token.value === 'unsafe') {
      fail('E_UNSAFE_UNSUPPORTED: unsafe effects and native grants are unavailable in JS guest code', token);
    }
    if (DOMAIN_WORDS.has(token.value)) {
      fail('execution domain \'' + token.value + '\' is reserved and not lowered by the JS backend;'
        + ' no implicit CPU fallback', token);
    }
    // `task` stays a contextual identifier; only the block form is a Task.
    if (token.value === 'task' && opensBlock) {
      fail('execution task requires scheduler-aware Future lowering; no implicit inline execution', token);
    }
    if (token.value === 'nb' && opensBlock) {
      fail('legacy nb execution task requires scheduler-aware Future lowering; no implicit inline execution', token);
    }
  }
}
