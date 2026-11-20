// Compiler-owned pre-HIR model, NOT an executable actor/stream runtime.
// Stage metadata must come from a trusted typechecker and TenantVM capability
// registry. This module never mints ActorRef, I/O grants or supervisor CONTROL.
export class DirectedPipeError extends Error {
  constructor(code) { super(code); this.name='DirectedPipeError'; this.code=code; }
}
const reject = code => { throw new DirectedPipeError(code); };
const encoder = new TextEncoder(), branded = new WeakSet();

function own(record, field) {
  if (record===null || typeof record!=='object') reject('E_PIPE_DESCRIPTOR');
  const prop=Object.getOwnPropertyDescriptor(record,field);
  if (!prop || !Object.hasOwn(prop,'value')) reject('E_PIPE_DESCRIPTOR');
  return prop.value;
}
function label(raw, error='E_PIPE_ID', type=false) {
  if (typeof raw!=='string' || !raw.length || raw.length>256 ||
      encoder.encode(raw).length>256 ||
      !(type
        ? /^[A-Za-z_][A-Za-z0-9_.<>]*$/.test(raw)
        : /^[A-Za-z_][A-Za-z0-9_-]*$/.test(raw)))
    reject(error);
  return raw;
}
function stage(candidate) {
  const id=label(own(candidate,'id'));
  const tenant=label(own(candidate,'tenant'),'E_PIPE_TENANT_ID');
  const kind=own(candidate,'kind');
  const inType=own(candidate,'receives'), outType=own(candidate,'emits');
  const receives=inType===null?null:label(inType,'E_PIPE_TYPE_LABEL',true);
  const emits=outType===null?null:label(outType,'E_PIPE_TYPE_LABEL',true);
  if (!['actor','channel','stream-readable','stream-sink','stream-duplex'].includes(kind))
    reject('E_PIPE_KIND');
  if (!receives && !emits) reject('E_PIPE_PORTS');
  if (kind==='channel'||kind==='stream-duplex') {
    if (!receives || !emits || receives!==emits) reject('E_PIPE_CHANNEL_PORTS');
  } else if (kind==='stream-readable' && (receives!==null || !emits)) {
    reject('E_PIPE_READONLY_PORT');
  } else if (kind==='stream-sink' && (!receives || emits!==null)) {
    reject('E_PIPE_WRITEONLY_PORT');
  }
  // Actor emits is explicit and independent of any "sends" contract.
  return Object.freeze({id,tenant,kind,receives,emits});
}
export function plan_directed_pipe(writtenStages, direction) {
  if (direction!=='pipe' && direction!=='rpipe') reject('E_PIPE_DIRECTION');
  if (!Array.isArray(writtenStages)) reject('E_PIPE_STAGES');
  const len=Object.getOwnPropertyDescriptor(writtenStages,'length')?.value;
  if (!Number.isSafeInteger(len) || len<2 || len>16) reject('E_PIPE_STAGE_LIMIT');
  const written=[], ids=new Set();
  let tenant;
  for (let i=0;i<len;i++) {
    const s=stage(own(writtenStages,String(i)));
    if (tenant!==undefined && tenant!==s.tenant) reject('E_PIPE_TENANT_BOUNDARY');
    if (ids.has(s.id)) reject('E_PIPE_DUPLICATE_STAGE');
    ids.add(s.id);
    tenant=s.tenant;written.push(s);
  }
  const order=Array.from({length:len},(_,i)=>direction==='pipe'?i:len-i-1);
  const edges=[];
  for (let i=0;i<len-1;i++) {
    const source=written[order[i]],sink=written[order[i+1]];
    if (!source.emits) reject('E_PIPE_MISSING_EMITS');
    if (!sink.receives) reject('E_PIPE_MISSING_RECEIVES');
    if (source.emits!==sink.receives) reject('E_PIPE_TYPE_MISMATCH');
    edges.push(Object.freeze({source:source.id,sink:sink.id,payload:source.emits,
      source_written_index:order[i],sink_written_index:order[i+1]}));
  }
  const plan=Object.freeze({direction,tenant,writtenStages:Object.freeze(written),
    flowIndices:Object.freeze(order),dataEdges:Object.freeze(edges)});
  branded.add(plan);
  return plan;
}
// Cross-expression single-writer port reservation *preflight*. Runtime must
// still enforce atomic setup, rollback, cancellation, ownership and generation.
export function check_unicast_pipe_plans(plans) {
  if (!Array.isArray(plans)) reject('E_PIPE_PLANS');
  const length=Object.getOwnPropertyDescriptor(plans,'length')?.value;
  if (!Number.isSafeInteger(length)||length>64)reject('E_PIPE_PLAN_LIMIT');
  const edges=new Set(),outputs=new Set();
  for(let i=0;i<length;i++) {
    const plan=own(plans,String(i));
    if (!branded.has(plan)) reject('E_PIPE_PLAN_CAPABILITY');
    for(const edge of plan.dataEdges) {
      const source=JSON.stringify([plan.tenant,edge.source]);
      const pair=JSON.stringify([source,edge.sink]);
      if (edges.has(pair)) reject('E_PIPE_DUPLICATE_EDGE');
      if (outputs.has(source)) reject('E_PIPE_OUTPUT_OCCUPIED');
      edges.add(pair);outputs.add(source);
    }
  }
  return true;
}
