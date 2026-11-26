// Linux x86-64 trusted-host cache. Host protects ancestors and trusted procfs;
// arbitrary same-UID writes and mount changes are outside the threat model.
// Fixed slots and per-slot exclusive staging preserve cooperative writers.
// Abandoned staging requires offline cleanup, never steal a live writer.
import {openSync,closeSync,readSync,writeFileSync,fsyncSync,renameSync,unlinkSync,fstatSync,constants} from 'node:fs';
import {resolve,join} from 'node:path';
import {admitLedgerRecord,sealReceipt,verifyReceipt} from './compiler-cache-envelope.node.mjs';
const MAX=112+4*1024*1024,O_PATH=0o10000000;
export const MAX_STORE_FILES=32;
export const MAX_STORE_BYTES=MAX_STORE_FILES*MAX;
function invalid(){throw Error('E_CACHE_PATH: private regular inode required');}
function ownerOnly(s){if(s.uid!==process.geteuid()||(s.mode&0o077)!==0)invalid();}
function slot(key){if(typeof key!=='string'||!/^[0-9a-f]{64}$/.test(key))throw Error('E_CACHE_KEY: digest');return 'slot-'+key[0];}
const via=fd=>'/proc/self/fd/'+fd;
function rootFd(root){
 let fd=openSync('/',constants.O_RDONLY|constants.O_DIRECTORY);
 try{
  for(const part of root.split('/').filter(Boolean)){
   const next=openSync(join(via(fd),part),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
   closeSync(fd);fd=next;
  }
  const s=fstatSync(fd);ownerOnly(s);if(!s.isDirectory())invalid();return fd;
 }catch(e){closeSync(fd);throw e;}
}
function same(a,b){return a.dev===b.dev&&a.ino===b.ino;}
function regular(s,allowUnlinked=false){ownerOnly(s);if(!s.isFile()||s.nlink>1||(!allowUnlinked&&s.nlink!==1)||s.size<112||s.size>MAX)invalid();}
function pin(path){
 let fd;try{fd=openSync(path,O_PATH|constants.O_NOFOLLOW);}catch(e){if(e.code==='ENOENT')return null;throw e;}
 try{regular(fstatSync(fd),true);return fd;}catch(e){closeSync(fd);throw e;}
}
function existing(path){const fd=pin(path);if(fd!==null)closeSync(fd);}
export class TrustedArtifactStore {
 #root;#identity;
 constructor(root){
  if(process.platform!=='linux'||process.arch!=='x64')throw Error('E_CACHE_PATH: Linux x86-64 only');
  if(typeof root!=='string'||root.split('/').includes('..'))invalid();
  this.#root=resolve(root);const fd=rootFd(this.#root);
  try{this.#identity=fstatSync(fd,{bigint:true});}finally{closeSync(fd);}
 }
 #open(){let fd=rootFd(this.#root);try{if(!same(fstatSync(fd,{bigint:true}),this.#identity))invalid();return fd;}catch(e){closeSync(fd);throw e;}}
 load(key,scope,record,pinBytes,master){
  const name=slot(key),secret=admitLedgerRecord(scope,record,pinBytes,master);let root,pinned,fd;
  try{
   root=this.#open();pinned=pin(join(via(root),name));if(pinned===null)return null;
   fd=openSync(via(pinned),constants.O_RDONLY|constants.O_NONBLOCK);
   const s=fstatSync(fd);regular(s,true);
   if(!same(fstatSync(pinned,{bigint:true}),fstatSync(fd,{bigint:true})))invalid();
   const bytes=Buffer.alloc(s.size);let pos=0;
   while(pos<bytes.length){const n=readSync(fd,bytes,pos,bytes.length-pos,null);if(!n)invalid();pos+=n;}
   if(readSync(fd,Buffer.alloc(1),0,1,null)!==0)invalid();
   const actual=bytes.subarray(8,40).toString('hex');if(slot(actual)!==name)invalid();
   const payload=verifyReceipt(actual,bytes,secret);return actual===key?payload:null;
  }finally{try{if(fd!==undefined)closeSync(fd);}finally{try{if(pinned!=null)closeSync(pinned);}finally{try{if(root!==undefined)closeSync(root);}finally{secret.fill(0);}}}}
 }
 publish(key,artifact,scope,record,pinBytes,master){
  const name=slot(key),secret=admitLedgerRecord(scope,record,pinBytes,master);let root,fd,pending,owned=false;
  try{
   const envelope=sealReceipt(key,artifact,secret);root=this.#open();
   const path=join(via(root),name);existing(path);pending=join(via(root),'.pending-'+name);
   try{fd=openSync(pending,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);owned=true;}
   catch(e){if(e.code==='EEXIST')throw Error('E_CACHE_BUSY: slot staging exists');throw e;}
   writeFileSync(fd,envelope);fsyncSync(fd);closeSync(fd);fd=undefined;
   existing(path);renameSync(pending,path);owned=false;fsyncSync(root);
  }finally{try{if(fd!==undefined)closeSync(fd);}finally{try{if(owned)unlinkSync(pending);}finally{try{if(root!==undefined)closeSync(root);}finally{secret.fill(0);}}}}
 }
}
