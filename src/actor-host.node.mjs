import {Worker} from 'node:worker_threads';
import {createWorkerActorClient} from './worker-actor-client.mjs';
export function spawnNodeActor({moduleUrl, exportName = 'receive', mode = 'handler', maxPending = 64}) {
  const url = new URL(moduleUrl);
  // No eval/data URL: caller must provide a prebuilt trusted local ESM artifact.
  if (url.protocol !== 'file:') throw new TypeError('Node actor module must be a trusted file: URL');
  const worker = new Worker(new URL('./worker-actor.node.mjs', import.meta.url), {type:'module',execArgv:[]});
  try {return createWorkerActorClient({worker,moduleUrl:url.href,exportName,mode,maxPending});}
  catch (error) {void worker.terminate();throw error;}
}
