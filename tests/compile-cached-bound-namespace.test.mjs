import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {compileCachedBoundNamespace,boundNamespaceCompilerClosureSha256} from '../src/compile-cached-bound-namespace.node.mjs';
import {PinnedScalarNamespaceEsmSession} from '../src/pinned-scalar-namespace-esm.node.mjs';
import {makeLedgerRecord} from '../src/compiler-cache-envelope.node.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
const scope='tenant/bound-namespace',master=Buffer.alloc(32,7),ledgerRecord=makeLedgerRecord(scope,1n,master),ledgerPin=Buffer.from(hash(ledgerRecord),'hex');
const header='schema_version = "2"\n[project]\nroot = "."\n';
const providerManifest=header+'[packages.checkout]\nfiles = ["src/local.atto", "src/unit.atto"]\n';
const consumer='namespace app;\nimport namespace billing as p from "checkout";\npub fnc main(): void {\n  stdio.println(p.get(5+5,4));\n  return;\n}\n';
const base=new Map([['src/local.atto','pub fnc get(): int { return 900; }\n'],['src/unit.atto','namespace billing;\npub fnc get(int x, int y): int { return x * y + 2; }\n']]);
const local=new Map(base);local.set('src/local.atto',base.get('src/local.atto').replace('900','901'));
function options(root,sources=base,pm=providerManifest,source=consumer){
 const inventory=[...sources].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([p,s])=>p+'\n'+hash(s)+'\n').join('');
 const cm=header+'[packages.client]\nfiles = ["src/main.ores"]\n[namespace_dependencies.checkout]\nmanifest = "../checkout/.ores.pkg.toml"\npackage = "checkout"\nmanifest_sha256 = "'+hash(pm)+'"\nsources_sha256 = "'+hash(inventory)+'"\n';
 return {root,owner:'client@1',unit:'src/main.ores',consumer:source,consumerManifest:cm,providerManifest:pm,sources,
 expectedConsumerSha256:hash(source),expectedConsumerManifestSha256:hash(cm),expectedCompilerSha256:boundNamespaceCompilerClosureSha256(),scope,master,ledgerRecord,ledgerPin};
}
const execute=async code=>(await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))).main();
const disk=root=>new Map(readdirSync(root).sort().map(n=>[n,readFileSync(join(root,n))]));
test('persistent bound namespace actual guest, independently pinned edits and restart',async()=>{
 const child=process.env.ATTO_BOUND_NAMESPACE_CHILD;
 if(child){
   const b=compileCachedBoundNamespace(options(child,local));assert.equal(b.reused,1);assert.equal(b.compiled,0);
   assert.deepEqual(await execute(b.code),[42n]);console.log('BOUND_NAMESPACE_CHILD_HIT');return;
 }
 const root=mkdtempSync(join(tmpdir(),'atto-bound-namespace-'));
 try{
  const opts=options(root),a=compileCachedBoundNamespace(opts);
  assert.equal(a.emitted,1);assert.equal(a.compiled,1);assert.equal(a.argumentCompiled,1);
  assert.equal(a.code,new PinnedScalarNamespaceEsmSession().build(opts).code);assert.deepEqual(await execute(a.code),[42n]);
  const before=disk(root),b=compileCachedBoundNamespace(options(root,local));
  assert.equal(b.key,a.key);assert.equal(b.reused,1);assert.equal(b.classified,2);assert.equal(b.compiled,0);assert.equal(b.argumentCompiled,0);assert.deepEqual(disk(root),before);
  assert.throws(()=>compileCachedBoundNamespace({...opts,sources:local}),/source pin mismatch/);
  assert.throws(()=>compileCachedBoundNamespace({...options(root,local),expectedConsumerManifestSha256:opts.expectedConsumerManifestSha256}),/E_CACHE_INPUT/);
  assert.throws(()=>compileCachedBoundNamespace({...opts,expectedCompilerSha256:'0'.repeat(64)}),/E_CACHE_COMPILER/);
  assert.throws(()=>compileCachedBoundNamespace({...opts,ledgerPin:Buffer.alloc(32)}),/E_CACHE_LEDGER/);
  const invalid=new Map(local);invalid.set('src/local.atto','pub fnc get(): int { return missing(); }\n');
  assert.throws(()=>compileCachedBoundNamespace(options(root,invalid)));
  assert.throws(()=>compileCachedBoundNamespace(options(root,local,providerManifest,consumer.replace('5+5,4','5'))),/E_NAMESPACE_ARITY/);
  assert.deepEqual(disk(root),before);
  const env={...process.env,ATTO_BOUND_NAMESPACE_CHILD:root};delete env.NODE_TEST_CONTEXT;
  const p=spawnSync(process.execPath,['--test','--test-reporter=tap',new URL(import.meta.url).pathname],{env,encoding:'utf8',timeout:60000});
  assert.equal(p.status,0,p.stdout+p.stderr);assert.match(p.stdout,/BOUND_NAMESPACE_CHILD_HIT/);
  const edited=new Map(local);edited.set('src/unit.atto',base.get('src/unit.atto').replace('+ 2','+ 3'));
  const c=compileCachedBoundNamespace(options(root,edited));assert.equal(c.emitted,1);assert.notEqual(c.key,a.key);assert.deepEqual(await execute(c.code),[43n]);
  assert.equal(c.code,new PinnedScalarNamespaceEsmSession().build(options(root,edited)).code);
  const manifestEdit=providerManifest.replace('["src/local.atto", "src/unit.atto"]','["src/unit.atto", "src/local.atto"]');
  const d=compileCachedBoundNamespace(options(root,edited,manifestEdit));assert.equal(d.emitted,1);assert.notEqual(d.key,c.key);assert.equal(d.code,c.code);
  console.log('BOUND_NAMESPACE_ESM|guest=42/43|local-edit-and-child-hit|zero-codegen|independent-pins|manifest-miss|clean-equivalent');
 }finally{rmSync(root,{recursive:true,force:true});}
});
