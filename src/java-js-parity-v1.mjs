/**
 * Source-pinned JS execution observations for the Java semantic fixture subset.
 * A verified JS checkout is not evidence of Java/Graal execution.
 */
import {createHash} from 'node:crypto';
import {compileProgramV2, ProgramCompileError} from './program-v2.mjs';
import {PROGRAM_IR_INT_MODEL} from './program-ir-v2.mjs';

export const JAVA_FIXTURE_REVISION='e719222e2c4c8ff8eff5d3986ad1885bfc02bc7a';
export const FIXTURE_AUTHORITY='ores-truffle-oreslang/oreslang-source.java';
export const JS_PARITY_REPORT_FORMAT='oreslang-js-reference-fixtures-v1';

export const REFERENCE_CASES=Object.freeze([
  {id:'native.add',kind:'value',expected:'42',blob:'015f8b0f79aafa796a148d2adeff1574e8d6c491',
   source:'pub fnc main(): int { return 40 + 2; }\n'},
  {id:'native.precedence',kind:'value',expected:'40',blob:'2d09e697ad4eeac4ee263c3656b92998c67f0bfc',
   source:'pub fnc main(): int { return (2 + 3) * 8; }\n'},
  {id:'native.forward',kind:'value',expected:'42',blob:'63067f3b4ac9ad0f2550fa4ccc3314a9c05fc63b',
   source:'pub fnc main(): int { return times(7, 6); }\nfnc times(int a, int b): int { return a * b; }\n'},
  {id:'native.unary',kind:'value',expected:'42',blob:'f9376d50509ce4b69572c610547b96cfdaa4cd7d',
   source:'pub fnc main(): int { return -5 + 47; }\n'},
  {id:'native.underscores',kind:'value',expected:'42',blob:'9de6f26fac278174c9f86ae7fa63ad331f99e96a',
   source:'/* tokens */ pub fnc main(): int { return 4_0 + 2; }\n'},
  {id:'diagnostic.unknown',kind:'diagnostic',expected:'unknown_name',
   error:/unresolved identifier neverDeclared/,
   blob:'b942e9df050acb5bc8d291096b1435f5e0e0a83e',
   source:'pub fnc main(): int { return neverDeclared; }\n'},
  {id:'diagnostic.arity',kind:'diagnostic',expected:'call_arity',
   error:/call arity mismatch/,
   blob:'fbd0b9e28888c7f21dbf91fa676cbb849e389c2f',
   source:'fnc add(int a, int b): int { return a + b; }\npub fnc main(): int { return add(1); }\n'},
  {id:'diagnostic.duplicate',kind:'diagnostic',expected:'duplicate_declaration',
   error:/duplicate caller-visible arity/,
   blob:'e819095613496106885d6c6d223c9bd1a8bfa28f',
   source:'fnc f(): int { return 1; }\nfnc f(): int { return 2; }\n'},
  {id:'diagnostic.overflow',kind:'diagnostic',expected:'integer_overflow',
   error:/int literal outside provisional signed i64/,
   blob:'60a6dce7a302e0b54af26c49452afecb1b4ffb7c',
   source:'pub fnc main(): int { return 9223372036854775808; }\n'},
  {id:'diagnostic.comment',kind:'diagnostic',expected:'unterminated_comment',
   error:/unterminated comment/,
   blob:'e144dcbda7c5333cba38549ff754f697b3676bc2',
   source:'pub fnc main(): int { return 42; } /* unterminated /* nested\n'},
].map(Object.freeze));

export function gitBlobSha1(source) {
  const b=Buffer.from(source,'utf8');
  return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
}
export function fixtureSuiteSha256() {
  // Length-delimited, sorted-by-authority manifest. IDs, source bytes and expected
  // outcomes are independently bound, not just the set of file names.
  const hash=createHash('sha256').update('oreslang-js-reference-fixtures-v1\0');
  for(const c of REFERENCE_CASES) {
    for(const part of [c.id,c.kind,c.expected,c.blob,c.source]){
      const bytes=Buffer.from(part,'utf8');
      const len=Buffer.alloc(8);len.writeBigUInt64BE(BigInt(bytes.length));
      hash.update(len).update(bytes);
    }
  }
  return hash.digest('hex');
}
function assertFixtureAuthority() {
  const names=new Set();
  for(const c of REFERENCE_CASES) {
    if(names.has(c.id))throw Error('duplicate authority fixture '+c.id);
    names.add(c.id);
    if(gitBlobSha1(c.source)!==c.blob)
      throw Error('Java fixture Git blob changed: '+c.id);
  }
  if(names.size!==10)throw Error('incomplete Java reference fixture slice');
}

export async function executeJsReferenceFixtures() {
  assertFixtureAuthority();
  const results=[];
  for(const c of REFERENCE_CASES) {
    let observed;
    try {
      const esm=compileProgramV2(c.source);
      if(c.kind!=='value')throw Error('diagnostic fixture accepted: '+c.id);
      const ns=await import('data:text/javascript,'+encodeURIComponent(esm));
      const value=ns.main();
      if(typeof value!=='bigint')throw Error('not typed i64 BigInt: '+c.id);
      observed=value.toString();
    } catch(error) {
      if(c.kind!=='diagnostic'||!(error instanceof ProgramCompileError)||
         !c.error.test(error.message))
        throw Error('JS fixture divergence '+c.id+': '+String(error));
      observed=c.expected;
    }
    if(observed!==c.expected)throw Error('JS reference value mismatch '+c.id+': '+observed);
    results.push({
      id:c.id,fixture_git_blob:c.blob,kind:c.kind,status:'pass',
      ...(c.kind==='value'?{observed_int64:observed}:{diagnostic_class:observed})
    });
  }
  return {
    format:JS_PARITY_REPORT_FORMAT,
    backend:'js',
    fixture_authority:FIXTURE_AUTHORITY,
    fixture_authority_revision:JAVA_FIXTURE_REVISION,
    fixture_suite_sha256:fixtureSuiteSha256(),
    integer_model:PROGRAM_IR_INT_MODEL,
    execution:'real-node-guest',
    provenance_authenticated:false,
    java_execution_verified:false,
    results
  };
}

/**
 * Compare Java's existing semantic-report format to actual JS observations.
 * This is STRUCTURAL comparison only; it never attests Java checkout/build,
 * signature, runner provenance, guest execution, or language-wide parity.
 */
export function compareJavaAndJsReports(js,graal) {
  // No claim of provenance: this is a deliberately strict, structural
  // comparison over JSON-shaped reports. Authenticate CI separately.
  if(!js||js.format!==JS_PARITY_REPORT_FORMAT||js.backend!=='js'||
     js.fixture_authority!==FIXTURE_AUTHORITY||
     js.fixture_authority_revision!==JAVA_FIXTURE_REVISION||
     js.fixture_suite_sha256!==fixtureSuiteSha256()||
     js.integer_model!==PROGRAM_IR_INT_MODEL||
     js.execution!=='real-node-guest'||
     js.provenance_authenticated!==false||
     js.java_execution_verified!==false||
     !Array.isArray(js.results)||js.results.length!==REFERENCE_CASES.length)
    throw Error('invalid or incomplete JS fixture report');

  const jsLookup=new Map();
  for(const record of js.results) {
    if(!record||typeof record!=='object'||Array.isArray(record)||
       typeof record.id!=='string'||jsLookup.has(record.id))
      throw Error('duplicate/bad JS result');
    jsLookup.set(record.id,record);
  }
  if(!graal||graal.schema_version!=='1.1.0'||graal.backend!=='graal'||
     !/^[a-f0-9]{64}$/.test(graal.suite_sha256??'')||
     !/^[a-f0-9]{40}$/.test(graal.source_revision??'')||
     !Array.isArray(graal.results))throw Error('unverified Java report shape');
  const lookup=new Map();
  for(const r of graal.results) {
    if(!r||typeof r.id!=='string'||lookup.has(r.id))throw Error('duplicate/bad Java result');
    lookup.set(r.id,r);
  }
  const checked=[];
  for(const caseInfo of REFERENCE_CASES) {
    const ja=lookup.get(caseInfo.id), jsr=jsLookup.get(caseInfo.id);
    if(!ja||ja.status!=='pass'||!jsr||jsr.status!=='pass'||
       jsr.kind!==caseInfo.kind||jsr.fixture_git_blob!==caseInfo.blob)
      throw Error('missing/pending/failed required reference case: '+caseInfo.id);
    if(caseInfo.kind==='value') {
      if(typeof jsr.observed_int64!=='string'||
         !/^(0|-?[1-9][0-9]*)$/.test(jsr.observed_int64)||
         !Number.isSafeInteger(ja.observed_exit)||
         ja.observed_exit!==Number(jsr.observed_int64)||
         jsr.observed_int64!==caseInfo.expected)
        throw Error('backend value divergence: '+caseInfo.id);
    } else if(ja.diagnostic_class!==caseInfo.expected||
              jsr.diagnostic_class!==caseInfo.expected)
      throw Error('diagnostic-class divergence: '+caseInfo.id);
    checked.push(caseInfo.id);
  }
  return {
    structural_result:'MATCHING_FIXTURE_RESULTS_ONLY',
    cases_compared:checked,
    ja_report_revision:graal.source_revision,
    js_fixture_suite_sha256:js.fixture_suite_sha256,
    java_runner_authenticated:false,
    source_to_binary_authenticated:false,
    full_java_js_parity_certified:false
  };
}
