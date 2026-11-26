import test from 'node:test';
import assert from 'node:assert/strict';
import {compile,IncrementalSession} from '../src/compiler.mjs';
const first='fnc helper(int x): int { return x+1; } pub fnc main(): int { return helper(41); }';
const run=async code=>(await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))).main();
test('real scalar IR code generation reuses only exact checked function fragments',async()=>{
 const s=new IncrementalSession();const a=s.build(first,{cold:true});assert.deepEqual([a.emitted,a.reused],[2,0]);assert.equal(a.code,compile(first));assert.equal(await run(a.code),42n);
 const b=s.build(first);assert.deepEqual([b.emitted,b.reused],[0,2]);assert.equal(b.code,a.code);
 const edit=first.replace('x+1','x+2');const c=s.build(edit);assert.deepEqual([c.emitted,c.reused],[1,1]);assert.equal(c.code,compile(edit));assert.equal(await run(c.code),43n);
 const bad=edit.replace('helper(41)','missing(41)');let diagnostic;try{compile(bad)}catch(e){diagnostic=e.message;}assert.ok(diagnostic);assert.throws(()=>s.build(bad),e=>e.message===diagnostic);
 const recovered=s.build(edit);assert.deepEqual([recovered.emitted,recovered.reused],[0,2]);
 const shifted='fnc extra(): int { return 0; } '+edit;const d=s.build(shifted);assert.equal(d.code,compile(shifted));assert.equal(await run(d.code),43n);assert.equal(d.emitted,3);
 console.log('INCREMENTAL_JS|actual-esm=42/43|fragments=2/0,0/2,1/1|slot-shift|rollback');
});

import {TrustedArtifactStore} from '../src/compiler-artifact-store.node.mjs';
import {encodeCacheKey,makeLedgerRecord} from '../src/compiler-cache-envelope.node.mjs';
import {createHash} from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {spawnSync} from 'node:child_process';
const aSource=first, bSource=aSource.replace('x+1','x+2'), badSource=bSource.replace('helper(41)','missing(41)');
const hash=b=>createHash('sha256').update(b).digest();
const master=Buffer.alloc(32,7),record=makeLedgerRecord('tenant/a',2n,master),pin=hash(record);
const auth=['tenant/a',record,pin,master];
function artifactKey(s){
 const digest=b=>hash(b).toString('hex');
 // Fixture closure only; production host must attest all dependencies.
 const compiler=digest(fs.readFileSync(new URL('../src/compiler.mjs',import.meta.url)));
 return encodeCacheKey({stage:'esm',owner:'@test/cache',unitKind:'source-unit',unit:'main.atto',compiler,
 toolchain:digest(process.version),target:digest('node-esm'),configuration:digest('closed-scalar-fixture'),
 sources:digest(s),bindings:digest('no imports'),generated:null,dependencies:[]});
}
const fresh=s=>compile(s);
function cached(root,s,cold=false,requireHit=false){
 const store=new TrustedArtifactStore(root),key=artifactKey(s);
 if(!cold){const hit=store.load(key,...auth);if(hit!==null)return {code:hit.toString('utf8'),reused:true};}
 if(requireHit)throw Error('unexpected compiler invocation on restart');
 const code=fresh(s);store.publish(key,Buffer.from(code),...auth);return {code,reused:false};
}
async function executeCached(code,expected){assert.equal(await run(code),BigInt(expected));}
test('persistent compiler output executes across process restart',async()=>{
 const child=process.env.ATTO_CACHE_FIXTURE_CHILD;
 if(child){const warm=cached(child,aSource,false,true);assert.equal(warm.reused,true);await executeCached(warm.code,42);console.log('PERSISTENT_NODE_CHILD|no-compile|guest=42');return;}
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'atto-cache-'));try{
 const cold=cached(root,aSource,true);assert.equal(cold.reused,false);assert.equal(cold.code,fresh(aSource));await executeCached(cold.code,42);
 const p=spawnSync(process.execPath,['--test','--test-name-pattern=persistent compiler output',new URL(import.meta.url).pathname],{env:{...process.env,ATTO_CACHE_FIXTURE_CHILD:root},encoding:'utf8',timeout:60000});
 assert.equal(p.status,0,p.stdout+p.stderr);assert.match(p.stdout,/PERSISTENT_NODE_CHILD/);
 const edited=cached(root,bSource);assert.equal(edited.reused,false);assert.equal(edited.code,fresh(bSource));await executeCached(edited.code,43);
 const file=path.join(root,'slot-'+artifactKey(bSource)[0]),before=fs.readFileSync(file);
 assert.throws(()=>cached(root,badSource,true));assert.deepEqual(fs.readFileSync(file),before);assert.equal(cached(root,bSource,false,true).code,edited.code);
 const store=new TrustedArtifactStore(root);
 assert.throws(()=>store.load(artifactKey(bSource),'tenant/a',record,Buffer.alloc(32),master),/E_CACHE_LEDGER/);
 fs.chmodSync(file,0o644);assert.throws(()=>cached(root,bSource,false,true),/E_CACHE_PATH/);fs.chmodSync(file,0o600);
 fs.renameSync(file,file+'.saved');fs.symlinkSync(file+'.saved',file);assert.throws(()=>cached(root,bSource,false,true),/E_CACHE_PATH/);
 fs.unlinkSync(file);fs.renameSync(file+'.saved',file);
 const corrupt=Buffer.from(before);corrupt[80]^=1;fs.writeFileSync(file,corrupt);assert.throws(()=>cached(root,bSource,false,true),/E_CACHE_RECEIPT/);
 console.log('PERSISTENT_JS|cold=42|warm-child=42|edit=43|rollback|corruption-and-links-denied');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
