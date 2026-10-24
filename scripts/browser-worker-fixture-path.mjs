// Local-only Chrome smoke fixture resolver. Never use as a production
// static server. All filesystem paths and symlink targets must stay inside
// the dedicated source or test fixture trees.
import {realpath} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';

const MIME=Object.freeze({
  '.html':'text/html; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8',
  '.ores':'text/plain; charset=utf-8'
});
export class BrowserWorkerFixtureAccessError extends Error {
  constructor() {
    super('browser worker fixture path denied');
    this.name='BrowserWorkerFixtureAccessError';
  }
}
const deny=()=>{throw new BrowserWorkerFixtureAccessError();};

export async function resolveBrowserWorkerFixture(root,requestUrl) {
  if(typeof root!=='string'||typeof requestUrl!=='string'||
     requestUrl.length>4096)deny();
  // Reject traversal *before* URL canonicalization strips dot segments.
  // The browser HTTP server passes origin-form request paths only.
  const raw=requestUrl.split(/[?#]/,1)[0];
  if(!raw.startsWith('/')||raw.startsWith('//'))deny();
  const decoded=decodeURIComponent(raw);
  if(decoded.split('/').some(segment=>segment==='.'||segment==='..'))deny();
  const pathname=decodeURIComponent(new URL(requestUrl,'http://localhost').pathname);
  if(!/^\/(?:src\/|tests\/)/.test(pathname)||
     pathname.split('/').some(segment=>segment.startsWith('.')))deny();
  const directory=await realpath(root);
  const allow=[resolve(directory,'src')+sep,resolve(directory,'tests')+sep];
  const file=resolve(directory,pathname.slice(1));
  if(!allow.some(prefix=>file.startsWith(prefix)))deny();
  const extension=extname(file);
  if(!Object.hasOwn(MIME,extension))deny();
  // No user-controlled paths or followable symlinks may escape the allowlist.
  const target=await realpath(file);
  if(!allow.some(prefix=>target.startsWith(prefix)))deny();
  return Object.freeze({path:target,contentType:MIME[extension]});
}
