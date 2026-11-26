import {WorkerMixedLayout} from "../src/worker-mixed-layout.mjs";
export function openStore(options){
  const store=new WorkerMixedLayout(options);
  return {
    byteLength:store.byteLength,payloadBytes:store.payloadBytes,
    read:(row,field)=>store.read(row,field),
    write:(row,field,value)=>store.write(row,field,value),
    offset:(row,field)=>store.address(row,field).absoluteByteOffset,
    close:()=>store.retire()
  };
}
