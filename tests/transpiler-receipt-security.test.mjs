import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,readFile,writeFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
const inputs=[
  'src/program-v2.mjs','src/program-ir-v2.mjs','src/parity-json-strict.mjs',
  'scripts/transpiler-parity-receipt.mjs',
  'contracts/v1/transpiler-parity-candidates.json',
  'tests/transpiler-admission-audit.test.mjs',
  'tests/transpiler-strict-ir-matrix.test.mjs',
  'tests/transpiler-program-v2-matrix.test.mjs',
  'tests/transpiler-parity-candidates.test.mjs',
  'tests/transpiler-receipt-security.test.mjs'
];
const git=(cwd,...args)=>execFileSync('/usr/bin/git',args,{
  cwd,encoding:'utf8',env:{PATH:'/usr/bin:/bin',HOME:cwd,LANG:'C'}
});
async function fixture(){
  const dir=await mkdtemp(join(tmpdir(),'atto-js-receipt-test-'));
  for(const file of inputs){
    const dest=join(dir,file);
    await mkdir(dirname(dest),{recursive:true});
    await copyFile(join(root,file),dest);
  }
  git(dir,'init','-q');
  git(dir,'add','--','.');
  git(dir,'-c','user.name=JS Receipt Test','-c','user.email=receipt@example.invalid',
      'commit','-qm','isolated exact-source receipt fixture');
  return dir;
}
const receipt=dir=>spawnSync(process.execPath,
  ['scripts/transpiler-parity-receipt.mjs'],{
    cwd:dir,encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024,
    env:{PATH:'/usr/bin:/bin',HOME:dir,LANG:'C'}
  });
const supported=process.platform==='linux'||process.platform==='darwin';

test('source-local receipt executes 50 genuine generated ESM cases', {skip:!supported},async()=>{
  const dir=await fixture();
  try {
    const r=receipt(dir);
    assert.equal(r.status,0,r.stderr);
    const parsed=JSON.parse(r.stdout);
    assert.equal(parsed.passed_cases,50);
    assert.equal(parsed.failed_cases,0);
    assert.equal(parsed.results.length,50);
    assert.equal(parsed.scope,'source-local-node-esm-only');
    assert.equal(parsed.cross_backend_parity_verified,false);
    assert.match(parsed.git_head,/^[a-f0-9]{40}$/);
    assert.match(parsed.git_tree,/^[a-f0-9]{40}$/);
    assert.equal(Object.keys(parsed.physically_verified_git_blobs).length,inputs.length);
    assert.ok(parsed.results.every(x=>x.pass&&/^[a-f0-9]{64}$/.test(x.emitted_sha256)));
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('skip-worktree altered compiler cannot execute before physical verification',
  {skip:!supported},async()=>{
  const dir=await fixture();
  try {
    const path=join(dir,'src/program-v2.mjs');
    const original=await readFile(path,'utf8');
    const needle="import {writeFileSync} from 'node:fs';\nwriteFileSync('UNTRUSTED_PREIMPORT_EXECUTED','bad');\n";
    await writeFile(path,needle+original);
    git(dir,'update-index','--skip-worktree','src/program-v2.mjs');
    const r=receipt(dir);
    assert.notEqual(r.status,0);
    assert.match(r.stderr,/physical Git blob mismatch|index differs from HEAD/);
    await assert.rejects(access(join(dir,'UNTRUSTED_PREIMPORT_EXECUTED')),'compiler module executed before verification');
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('duplicate JSON keys cannot be laundered through JSON.parse',
  {skip:!supported},async()=>{
  const dir=await fixture();
  try {
    const file=join(dir,'contracts/v1/transpiler-parity-candidates.json');
    const before=await readFile(file,'utf8');
    const after=before.replace(/"schemaVersion"\s*:\s*1\s*,/,
      '"schemaVersion": 1, "schemaVersion": 1,');
    assert.notEqual(before,after);
    await writeFile(file,after);
    git(dir,'add','--','contracts/v1/transpiler-parity-candidates.json');
    git(dir,'-c','user.name=JS Receipt Test','-c','user.email=receipt@example.invalid',
        'commit','-qm','duplicate member rejection fixture');
    const r=receipt(dir);
    assert.notEqual(r.status,0);
    assert.match(r.stderr,/duplicate JSON member/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('uncommitted candidate mutation cannot claim an exact-head receipt',
  {skip:!supported},async()=>{
  const dir=await fixture();
  try {
    const file=join(dir,'contracts/v1/transpiler-parity-candidates.json');
    await writeFile(file,(await readFile(file,'utf8'))+' ');
    const r=receipt(dir);
    assert.notEqual(r.status,0);
    assert.match(r.stderr,/dirty checkout|physical Git blob mismatch/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
