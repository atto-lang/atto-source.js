import {terminateFailedWorkerSpawn} from './worker-actor-spawn-cleanup.mjs';
import {Worker} from 'node:worker_threads';
import {createWorkerActorClient,rejectUnsupportedWorkerPlacement} from './worker-actor-client.mjs';
function trustedLocalWorkerModuleUrl(moduleUrl) {
  const url = new URL(moduleUrl);
  // No eval/data URL or Windows UNC/network-share authority: caller must
  // supply a prebuilt trusted local ESM artifact. A file: scheme alone is
  // insufficient: file://server/share resolves to a UNC path on Windows.
  // Also reject authority-less //server paths and encoded path separators.
  // Keep this normalization gate independent of Worker creation so every
  // rejection is decided before any worker-side code can execute.
  if (url.protocol !== 'file:' || url.host !== '' ||
      url.pathname.startsWith('//') || /%(?:2f|5c)/i.test(url.pathname))
    throw new TypeError('Node actor module must be a trusted file: URL without remote authority or UNC path');
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
