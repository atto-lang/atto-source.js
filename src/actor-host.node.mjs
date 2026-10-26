import {terminateFailedWorkerSpawn} from './worker-actor-spawn-cleanup.mjs';
import {Worker} from 'node:worker_threads';
import {createWorkerActorClient,rejectUnsupportedWorkerPlacement} from './worker-actor-client.mjs';
export function spawnNodeActor(options) {
  rejectUnsupportedWorkerPlacement(options);
  const {moduleUrl, exportName = 'receive', mode = 'handler', maxPending = 64, maxPendingBytes = 32*1024*1024} = options;
  const url = new URL(moduleUrl);
  // No eval/data URL or Windows UNC/network-share authority: caller must
  // supply a prebuilt trusted local ESM artifact. A file: scheme alone is
  // insufficient: file://server/share resolves to a UNC path on Windows.
  // Also reject authority-less //server paths and encoded path separators,
  // which must not be delegated to platform-dependent file URL conversion.
  if (url.protocol !== 'file:' || url.host !== '' ||
      url.pathname.startsWith('//') || /%(?:2f|5c)/i.test(url.pathname))
    throw new TypeError('Node actor module must be a trusted file: URL without remote authority or UNC path');
  const worker = new Worker(new URL('./worker-actor.node.mjs', import.meta.url), {type:'module',execArgv:[]});
  try {return createWorkerActorClient({worker,moduleUrl:url.href,exportName,mode,maxPending,maxPendingBytes});}
  catch (error) {terminateFailedWorkerSpawn(worker);throw error;}
}
