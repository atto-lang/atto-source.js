// Explicit, bounded scalar provider/consumer linkage. Trusted Node code only.
import {createHash} from 'node:crypto';
import {compileScalarConsumer} from './compiler.mjs';
import {scalarInterface} from './scalar-package-interface.mjs';

const hash=x=>createHash('sha256').update(x,'utf8').digest('hex');
const fail=message=>{throw Error('E_SCALAR_LINK: '+message);};

// Build against a signature snapshot only, not a provider implementation.
// The output can be kept unchanged across compatible provider releases.
export function buildScalarConsumer({source,providerInterface}={}){
  if(typeof source!=='string'||source.length>262144||Buffer.byteLength(source,'utf8')>262144)fail('invalid consumer source');
  const abi=scalarInterface(providerInterface,'edge-js');
  const compiled=compileScalarConsumer(source,abi.entries);
  const consumer=scalarInterface(compiled.publicInterface,'edge-js');
  const moduleSource='export const providerInterfaceSha256='+JSON.stringify(abi.sha256)+';\n'+compiled.moduleSource;
  if(Buffer.byteLength(moduleSource,'utf8')>4194304)fail('consumer module too large');
  const manifest={schemaVersion:1,target:'edge-js',sourceSha256:hash(source),moduleSha256:hash(moduleSource),
    providerInterfaceSha256:abi.sha256,publicInterface:consumer.entries,interfaceSha256:consumer.sha256};
  const manifestJson=JSON.stringify(manifest);
  if(Buffer.byteLength(manifestJson,'utf8')>65536)fail('consumer manifest too large');
  return Object.freeze({manifestJson,moduleSource});
}

