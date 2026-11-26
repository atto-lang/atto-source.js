// Trusted-host Linux cache. All ancestors and root must be protected from
// untrusted writers. Fixed slots bound store-owned files, not arbitrary disk
// use. Abandoned staging files require offline operator cleanup; never steal
// a live writer's slot. No external monotonic pin provider or sandbox claim.
import {openSync,closeSync,readSync,writeFileSync,fsyncSync,renameSync,unlinkSync,lstatSync,fstatSync,constants} from 'node:fs';
import {resolve,join} from 'node:path';
import {admitLedgerRecord,sealReceipt,verifyReceipt} from './compiler-cache-envelope.node.mjs';
const MAX=112+4*1024*1024;
export const MAX_STORE_FILES=32; // 16 committed + 16 staging
export const MAX_STORE_BYTES=MAX_STORE_FILES*MAX;
function invalid(){throw Error('E_CACHE_PATH: private regular inode required');}
function ownerOnly(s){if(s.uid!==process.geteuid()||(s.mode&0o077)!==0)invalid();}
function slot(key){if(typeof key!=='string'||!/^[0-9a-f]{64}$/.test(key))throw Error('E_CACHE_KEY: digest');return 'slot-'+key[0];}
function existing(path){
 let s;try{s=lstatSync(path);}catch(e){if(e.code==='ENOENT')return null;throw e;}
 ownerOnly(s);if(!s.isFile()||s.nlink!==1||s.size<112||s.size>MAX)invalid();return s;
}
export class TrustedArtifactStore {
 #root;#dev;#ino;
 constructor(root){
  if(process.platform!=='linux')throw Error('E_CACHE_PATH: Linux only');
  this.#root=resolve(root);const s=lstatSync(this.#root);ownerOnly(s);if(!s.isDirectory())invalid();
  this.#dev=s.dev;this.#ino=s.ino;
 }
 #check(s){ownerOnly(s);if(!s.isDirectory()||s.dev!==this.#dev||s.ino!==this.#ino)invalid();}
 #path(key){this.#check(lstatSync(this.#root));return join(this.#root,slot(key));}
 load(key,scope,record,pin,master){
  const secret=admitLedgerRecord(scope,record,pin,master);let fd;
  try{
   const path=this.#path(key);
   if(!existing(path))return null;
   try{fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}
   catch(e){if(e.code==='ENOENT')return null;throw e;}
   // A concurrent atomic replacement may unlink the already-open inode.
   // Its descriptor still provides an immutable snapshot, not a path reopen.
   const s=fstatSync(fd);ownerOnly(s);if(!s.isFile()||s.nlink>1||s.size<112||s.size>MAX)invalid();
   const bytes=Buffer.alloc(s.size);let pos=0;
   while(pos<bytes.length){const n=readSync(fd,bytes,pos,bytes.length-pos,null);if(!n)invalid();pos+=n;}
   if(readSync(fd,Buffer.alloc(1),0,1,null)!==0)invalid();
   const actual=bytes.subarray(8,40).toString('hex');if(slot(actual)!==slot(key))invalid();
   const payload=verifyReceipt(actual,bytes,secret);return actual===key?payload:null;
  }finally{try{if(fd!==undefined)closeSync(fd);}finally{secret.fill(0);}}
 }
 // Trusted compiler publisher only. Contention is explicit and leaves the
 // committed entry unchanged. A failed directory sync is not a durable commit
 // receipt (the renamed entry may nevertheless be visible).
 publish(key,artifact,scope,record,pin,master){
  const secret=admitLedgerRecord(scope,record,pin,master);let fd,dirfd,pending,owned=false;
  try{
   const path=this.#path(key),envelope=sealReceipt(key,artifact,secret);
   dirfd=openSync(this.#root,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);this.#check(fstatSync(dirfd));
   existing(path);
   pending=join(this.#root,'.pending-'+slot(key));
   try{fd=openSync(pending,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);owned=true;}
   catch(e){if(e.code==='EEXIST')throw Error('E_CACHE_BUSY: slot staging exists');throw e;}
   writeFileSync(fd,envelope);fsyncSync(fd);closeSync(fd);fd=undefined;
   this.#check(lstatSync(this.#root));existing(path);
   renameSync(pending,path);owned=false;
   fsyncSync(dirfd);
  }finally{
   try{if(fd!==undefined)closeSync(fd);}
   finally{try{if(owned)unlinkSync(pending);}
   finally{try{if(dirfd!==undefined)closeSync(dirfd);}finally{secret.fill(0);}}}
  }
 }
}
