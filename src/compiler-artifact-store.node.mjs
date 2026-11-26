// Experimental trusted-host Linux store. All ancestors and the root must
// be protected from untrusted writers. Not a hostile-filesystem sandbox:
// synchronous calls require exclusive host serialization across processes.
// No directory durability guarantee or external monotonic pin provider.
import {openSync,closeSync,readSync,writeFileSync,fsyncSync,renameSync,unlinkSync,lstatSync,fstatSync,constants} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {admitLedgerRecord,sealReceipt,verifyReceipt} from './compiler-cache-envelope.node.mjs';
const MAX=112+4*1024*1024;
function invalid(){throw Error('E_CACHE_PATH: private regular inode required');}
function ownerOnly(s){if(s.uid!==process.geteuid()||(s.mode&0o077)!==0)invalid();}
function slot(key){if(typeof key!=='string'||!/^[0-9a-f]{64}$/.test(key))throw Error('E_CACHE_KEY: digest');return 'slot-'+key[0];}
export class TrustedArtifactStore {
 #root;
 constructor(root){
  if(process.platform!=='linux')throw Error('E_CACHE_PATH: Linux only');
  this.#root=resolve(root);const s=lstatSync(this.#root);ownerOnly(s);if(!s.isDirectory())invalid();
 }
 #path(key){const s=lstatSync(this.#root);ownerOnly(s);if(!s.isDirectory())invalid();return join(this.#root,slot(key));}
 load(key,scope,record,pin,master){
  const secret=admitLedgerRecord(scope,record,pin,master);let fd;
  try{
   const path=this.#path(key);
   try{const s=lstatSync(path);ownerOnly(s);if(!s.isFile()||s.nlink!==1)invalid();fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}
   catch(e){if(e.code==='ENOENT')return null;throw e;}
   const s=fstatSync(fd);ownerOnly(s);if(!s.isFile()||s.nlink!==1||s.size<112||s.size>MAX)invalid();
   const bytes=Buffer.alloc(s.size);let pos=0;
   while(pos<bytes.length){const n=readSync(fd,bytes,pos,bytes.length-pos,null);if(!n)invalid();pos+=n;}
   if(readSync(fd,Buffer.alloc(1),0,1,null)!==0)invalid();
   const actual=bytes.subarray(8,40).toString('hex');if(slot(actual)!==slot(key))invalid();
   const payload=verifyReceipt(actual,bytes,secret);return actual===key?payload:null;
  }finally{if(fd!==undefined)closeSync(fd);secret.fill(0);}
 }
 // Trusted compiler publisher only. Caller authenticates the complete
 // compilation inputs; never expose this method to a guest or tenant.
 publish(key,artifact,scope,record,pin,master){
  const secret=admitLedgerRecord(scope,record,pin,master);let fd,pending;
  try{
   const path=this.#path(key),envelope=sealReceipt(key,artifact,secret);
   pending=join(this.#root,'.pending-'+randomBytes(16).toString('hex'));
   fd=openSync(pending,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
   writeFileSync(fd,envelope);fsyncSync(fd);closeSync(fd);fd=undefined;
   renameSync(pending,path);pending=undefined;
  }finally{if(fd!==undefined)closeSync(fd);if(pending!==undefined)try{unlinkSync(pending);}catch(e){if(e.code!=='ENOENT')throw e;}secret.fill(0);}
 }
}
