// Run the exact shared nominal-method corpus with the actual JS compiler.
// Exit 0 = complete coverage, 1 = failed verification, 2 = unsupported cases.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const CORPUS = '9fa4f22c0b1ea9468aad2657cfff7b5b02869cde';
const COMPILER_BLOBS = Object.freeze({
  'verified-quantity-source': '0899735480493b3b91496bd931f7ffc6e3f02d38',
  'bang-keyword-separator': '4f411b621d4abc27ddb3931e41b52838ef3a67c2',
  'program-ir-v2': 'd2db7c4835167f7f8d86b52004222488f9ab2655',
  'compiler-owned-testing-scalar': '851c70ab1a136a4669363380c27561a5032541d4',
  'execution-domain-admission': 'e1ac9a3ace91e3f319af62f46b0b2f64221dc416',
  'http-actor-admission': '68e5c40ed87b963b4f3eac3634ae9e2879d13076',
  'automatic-prelude': 'd31b0dfba5c904cce0bd304e384477905b4cfbd4',
  'core-boolean-intrinsics': 'b5e07b0ef31049f0e5eb7bef4f9b24096a66f8d6',
  'program-v2': '8cd852a9e6ed3eb6693de1f162be3ce8ce44b9a2',
});
const DIAGNOSTICS = Object.freeze({
  OBSOLETE_METHOD_INTRODUCER: /obsolete method introducer/,
  DUPLICATE_INSTANCE_METHOD: /duplicate method name\/arity/,
  MISSING_INSTANCE_OBLIGATION: /MISSING_INSTANCE_OBLIGATION/,
});
export function gitBlob(bytes) {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}
export function classifyRejection(caseSpec, error, CompilerError) {
  if (!(error instanceof CompilerError)) return 'FAIL';
  const expected = DIAGNOSTICS[caseSpec.diagnostic_family];
  if (caseSpec.expect !== 'compile_and_run' && expected?.test(error.message)) return 'PASS_DIAGNOSTIC';
  if (/^(actor|struct)\./.test(caseSpec.id) &&
      /expected module, found (actor|struct)|DECL_KIND_UNSUPPORTED/.test(error.message)) return 'UNSUPPORTED_PROFILE';
  return 'FAIL';
}
function verifyCompilerFiles() {
  for (const [name, want] of Object.entries(COMPILER_BLOBS)) {
    const bytes = readFileSync(new URL(`../src/${name}.mjs`, import.meta.url));
    if (gitBlob(bytes) !== want) throw Error(`compiler blob mismatch: ${name}`);
  }
}
const guestProgram = `import {readFileSync} from 'node:fs';
const code=readFileSync(0);
const mod=await import('data:text/javascript;base64,'+code.toString('base64'));
if(typeof mod.main!=='function'||mod.main()!==42n)process.exit(3);
process.stdout.write('42\\n');`;
export function executeGuest(esm) {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', guestProgram], {
    input: esm, encoding: 'utf8', timeout: 10000, maxBuffer: 1048576,
  });
  return !child.error && !child.signal && child.status === 0 &&
    child.stdout === '42\n' && child.stderr === '';
}
async function main() {
  if (process.argv.length !== 3) throw Error('usage: node scripts/verify-nominal-method-corpus.mjs CORPUS.json');
  const bytes = readFileSync(process.argv[2]);
  if (gitBlob(bytes) !== CORPUS) throw Error('wrong corpus Git blob');
  verifyCompilerFiles();
  const { compileProgramV2, ProgramCompileError } = await import('../src/program-v2.mjs');
  const corpus = JSON.parse(bytes);
  const rows = [];
  for (const c of corpus.cases) {
    let esm;
    try { esm = compileProgramV2(c.source); }
    catch (error) {
      rows.push({id:c.id, status:classifyRejection(c,error,ProgramCompileError), diagnostic:String(error.message)});
      continue;
    }
    const status = c.expect === 'compile_and_run' && executeGuest(esm) ? 'PASS_GUEST' : 'FAIL';
    rows.push({id:c.id, status, esm_sha256:createHash('sha256').update(esm).digest('hex')});
  }
  verifyCompilerFiles();
  const counts = {};
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
  console.log(JSON.stringify({profile:'bounded-js-nominal-esm',corpus_git_blob:CORPUS,compiler_blobs:COMPILER_BLOBS,node:process.version,counts,cases:rows},null,2));
  return rows.length !== 120 || counts.FAIL ? 1 : counts.UNSUPPORTED_PROFILE ? 2 : 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(status=>{process.exitCode=status;}).catch(error=>{console.error(error.message);process.exitCode=1;});
}
