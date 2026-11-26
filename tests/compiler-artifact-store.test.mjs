import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {TrustedArtifactStore,MAX_STORE_FILES,MAX_STORE_BYTES} from '../src/compiler-artifact-store.node.mjs';
import {makeLedgerRecord} from '../src/compiler-cache-envelope.node.mjs';
const master=Buffer.alloc(32,7),scope='tenant/cache',record=makeLedgerRecord(scope,1n,master),pin=createHash('sha256').update(record).digest();
const auth=[scope,record,pin,master],key='a'.repeat(64),other='a'+'b'.repeat(63);
function scratch(fn){const d=fs.mkdtempSync(join(tmpdir(),'atto-cache-test-'));try{return fn(d);}finally{fs.rmSync(d,{recursive:true,force:true});}}
test('restart, collision and failed publish preserve verified output',()=>scratch(d=>{
 const s=new TrustedArtifactStore(d);s.publish(key,Buffer.from('first'),...auth);
 assert.equal(new TrustedArtifactStore(d).load(key,...auth).toString(),'first');assert.equal(s.load(other,...auth),null);
 assert.throws(()=>s.publish(other,Buffer.alloc(4*1024*1024+1),...auth),/E_CACHE_RECEIPT/);
 assert.equal(s.load(key,...auth).toString(),'first');s.publish(other,Buffer.from('second'),...auth);
 assert.equal(s.load(key,...auth),null);assert.equal(s.load(other,...auth).toString(),'second');
}));
test('occupied staging remains untouched and committed slot survives contention',()=>scratch(d=>{
 const s=new TrustedArtifactStore(d);s.publish(key,Buffer.from('old'),...auth);
 const pending=join(d,'.pending-slot-a');fs.writeFileSync(pending,'abandoned',{mode:0o600});
 assert.throws(()=>s.publish(key,Buffer.from('new'),...auth),/E_CACHE_BUSY/);
 assert.equal(fs.readFileSync(pending,'utf8'),'abandoned');assert.equal(s.load(key,...auth).toString(),'old');
 fs.unlinkSync(pending);s.publish(key,Buffer.from('new'),...auth);assert.equal(s.load(key,...auth).toString(),'new');
}));
test('symlink, hardlink and replaced root rejected without destination overwrite',()=>scratch(d=>{
 const s=new TrustedArtifactStore(d);s.publish(key,Buffer.from('old'),...auth);
 const file=join(d,'slot-a'),save=join(d,'saved');fs.renameSync(file,save);fs.symlinkSync(save,file);
 assert.throws(()=>s.publish(key,Buffer.from('new'),...auth),/E_CACHE_PATH/);assert.ok(fs.lstatSync(file).isSymbolicLink());
 fs.unlinkSync(file);fs.linkSync(save,file);assert.throws(()=>s.load(key,...auth),/E_CACHE_PATH/);assert.throws(()=>s.publish(key,Buffer.from('new'),...auth),/E_CACHE_PATH/);
 fs.unlinkSync(file);fs.renameSync(save,file);const nested=join(d,'root');fs.mkdirSync(nested,{mode:0o700});const pinned=new TrustedArtifactStore(nested);
 fs.renameSync(nested,nested+'-old');fs.mkdirSync(nested,{mode:0o700});assert.throws(()=>pinned.publish(key,Buffer.from('new'),...auth),/E_CACHE_PATH/);
}));
test('fixed slots bound retained files and abandoned staging count',()=>scratch(d=>{
 const s=new TrustedArtifactStore(d);for(let i=0;i<256;i++){const k=i.toString(16).padStart(2,'0')+'0'.repeat(62);s.publish(k,Buffer.from('payload'),...auth);}
 assert.equal(fs.readdirSync(d).length,16);assert.equal(MAX_STORE_FILES,32);assert.equal(MAX_STORE_BYTES,32*(112+4*1024*1024));
 for(const ch of '0123456789abcdef')fs.writeFileSync(join(d,'.pending-slot-'+ch),'stale',{mode:0o600});
 assert.equal(fs.readdirSync(d).length,32);assert.throws(()=>s.publish(key,Buffer.from('new'),...auth),/E_CACHE_BUSY/);assert.equal(fs.readdirSync(d).length,32);
}));
test('authenticated corruption and stale epoch fail closed',()=>scratch(d=>{
 const s=new TrustedArtifactStore(d);s.publish(key,Buffer.from('old'),...auth);const p=join(d,'slot-a'),b=fs.readFileSync(p);b[112]^=1;fs.writeFileSync(p,b);
 assert.throws(()=>s.load(key,...auth),/E_CACHE_RECEIPT/);s.publish(key,Buffer.from('new'),...auth);
 const newer=makeLedgerRecord(scope,2n,master),newPin=createHash('sha256').update(newer).digest();
 assert.throws(()=>s.load(key,scope,newer,newPin,master),/E_CACHE_RECEIPT/);
}));
test('concurrent process writers never expose partial receipts',async()=>{
 const d=fs.mkdtempSync(join(tmpdir(),'atto-cache-concurrent-'));
 try{
  const module=new URL('../src/compiler-artifact-store.node.mjs',import.meta.url).href;
  const envelope=new URL('../src/compiler-cache-envelope.node.mjs',import.meta.url).href;
  const script=`import {TrustedArtifactStore} from ${JSON.stringify(module)};import {makeLedgerRecord} from ${JSON.stringify(envelope)};import {createHash} from 'node:crypto';const m=Buffer.alloc(32,7),r=makeLedgerRecord('tenant/cache',1n,m),p=createHash('sha256').update(r).digest(),s=new TrustedArtifactStore(process.argv[1]),k='a'.repeat(64);for(let i=0;i<40;i++){try{s.publish(k,Buffer.from(process.argv[2]),'tenant/cache',r,p,m);}catch(e){if(!/E_CACHE_BUSY/.test(e.message))throw e;}const b=s.load(k,'tenant/cache',r,p,m);if(b&&!['one','two'].includes(b.toString()))throw Error('partial');}`;
  const run=value=>new Promise((res,rej)=>{const p=spawn(process.execPath,['--input-type=module','-e',script,d,value],{stdio:['ignore','ignore','pipe']});let err='';p.stderr.on('data',x=>err+=x);p.on('error',rej);p.on('exit',code=>code===0?res():rej(Error(err)));});
  await Promise.all([run('one'),run('two')]);const s=new TrustedArtifactStore(d);assert.ok(['one','two'].includes(s.load(key,...auth).toString()));assert.deepEqual(fs.readdirSync(d),['slot-a']);
 }finally{fs.rmSync(d,{recursive:true,force:true});}
});
