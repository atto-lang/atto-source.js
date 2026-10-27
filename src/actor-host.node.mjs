import {terminateFailedWorkerSpawn} from './worker-actor-spawn-cleanup.mjs';
import {Worker} from 'node:worker_threads';
import {createWorkerActorClient,rejectUnsupportedWorkerPlacement} from './worker-actor-client.mjs';
function trustedLocalWorkerModuleUrl(moduleUrl) {
  // Inspect one stable string representation before WHATWG normalization.
  // Node versions differ in how aggressively backslashes are treated as URL
  // separators; a raw backslash must never become a platform-dependent path.
  const raw = moduleUrl instanceof URL ? moduleUrl.href : String(moduleUrl);
  // Refuse shorthand file:relative and file:/absolute spellings that Node
  // silently normalizes into a different absolute file URL.
  if (raw.includes('\\') || !/^file:\/\/(?:\/|localhost\/)/i.test(raw))
    throw new TypeError('Node actor module must be a trusted file: URL without remote authority or UNC path');
  const url = new URL(raw);
  // No eval/data URL or Windows UNC/network-share authority: caller must
  // supply a prebuilt trusted local ESM artifact. A file: scheme alone is
  // insufficient: file://server/share resolves to a UNC path on Windows.
  // Reject repeated path separators too: newer Node 22 URL normalization can
  // turn file:/\\server\\share into file:///server//share, erasing the raw
  // backslash while preserving a noncanonical UNC-like shape.
  // Percent-encoded NUL is not a valid local filename; deny before spawning.
  // Malformed percent escapes cannot be decoded to filesystem path bytes.
  if (url.protocol !== 'file:' || url.host !== '' ||
      url.pathname.includes('//') || /%(?:00|2f|5c)/i.test(url.pathname) ||
      /%(?![0-9a-f]{2})/i.test(url.pathname))
    throw new TypeError('Node actor module must be a trusted file: URL without remote authority or UNC path');
  // Valid-looking hex escapes can still encode invalid UTF-8 (e.g. %FF,
  // overlong encodings and surrogate sequences). Node's file URL decoder
  // rejects those values, so fail here before Worker allocation.
  try { decodeURIComponent(url.pathname); }
  catch { throw new TypeError('Node actor module must be a trusted file: URL without remote authority or UNC path'); }
  return url;
}

export function spawnNodeActor(options) {
  rejectUnsupportedWorkerPlacement(options);
  const {moduleUrl, exportName = 'receive', mode = 'handler', maxPending = 64, maxPendingBytes = 32*1024*1024} = options;
  const url = trustedLocalWorkerModuleUrl(moduleUrl);
  const worker = new Worker(new URL('./worker-actor.node.mjs', import.meta.url), {type:'module',execArgv:[]});
  try {return createWorkerActorClient({worker,moduleUrl:url.href,exportName,mode,maxPending,maxPendingBytes});}
  catch (error) {terminateFailedWorkerSpawn(worker);throw error;}
}
