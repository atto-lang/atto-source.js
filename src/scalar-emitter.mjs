import {validateScalarIR} from './scalar-ir.mjs';
import {CompileError} from './compile-error.mjs';
function emitScalarIR(input, externalCount, prior) {
  const next=new Map();let emitted=0,reused=0;
  const ir = validateScalarIR(input);
  const fns = ir.functions;
  if(!Number.isSafeInteger(externalCount)||externalCount<0||externalCount>128||externalCount>=fns.length||
     fns.slice(0,externalCount).some(f=>f.pub||f.body.kind!=='int'||f.body.value!=='0'))
    throw new CompileError('invalid external scalar slot boundary');
  function lower(e, depth = 0) {
    if (depth > 384) throw new CompileError('expression depth limit during lowering');
    if (e.kind === 'int') return e.value + 'n';
    if (e.kind === 'param') return '_p' + e.index;
    if (e.kind === 'neg') return 'BigInt.asIntN(64,-(' + lower(e.inner, depth+1) + '))';
    if (e.kind === 'binary') {
      // Inline so programs without Integer.mod keep byte-identical output.
      if (e.op === 'mod')
        return '((a,b)=>{if(b===0n)throw new RangeError("ORES_I64_DIVISION_BY_ZERO: checked signed 64-bit remainder by zero");const r=a%b;return r<0n?BigInt.asIntN(64,b>0n?r+b:r-b):r;})(' +
          lower(e.left, depth+1) + ',' + lower(e.right, depth+1) + ')';
      return 'BigInt.asIntN(64,(' + lower(e.left, depth+1) + ')' + e.op + '(' +
        lower(e.right, depth+1) + '))';
    }
    if (e.kind === 'call') {
      return '_f' + e.target + '(' + e.args.map(arg => lower(arg, depth+1)).join(',') + ')';
    }
    throw new CompileError('invalid IR expression');
  }
  const out = [
    '// Oreslang JS scalar subset. Signed i64 wrapping is PROVISIONAL, not proven Java parity.',
    'function _int(v){if(typeof v!=="bigint"||v<-(1n<<63n)||v>(1n<<63n)-1n)throw new TypeError("Oreslang int requires a signed i64 BigInt");return v;}',
  ];
  if (externalCount) {
    out.push('export function bindProvider(bindings){',
      'if(!Array.isArray(bindings)||bindings.length!=='+externalCount+')throw new TypeError("invalid provider bindings");');
    for(let i=0;i<externalCount;i++){
      const params=fns[i].params.map((_,j)=>'_p'+j);
      out.push('const _b'+i+'=bindings['+i+'];',
        'if(typeof _b'+i+'!=="function")throw new TypeError("missing provider binding");',
        'function _f'+i+'('+params.join(',')+'){return _int(_b'+i+'('+params.map(p=>'_int('+p+')').join(',')+'));}');
    }
  }
  fns.forEach((f,i) => {
    if(i<externalCount)return;
    // Checked IR is canonical; external slots/arity are validated anew.
    // Count the external boundary in the key, so closed and bound forms
    // cannot share a fragment even when the local slot happens to match.
    const key=JSON.stringify([externalCount,i,f]);
    let body=prior.get(key);
    if(body===undefined){
      const params=f.params.map((_,j)=>'_p'+j);
      body=['function _f'+i+'('+params.join(',')+'){',...params.map(p=>'_int('+p+');'),'return '+lower(f.body)+';','}'].join('\n');
      emitted++;
    }else reused++;
    next.set(key,body);out.push(body);
  });
  if(externalCount){
    out.push('const api=Object.create(null);');
    fns.forEach((f,i)=>{if(f.pub)out.push('api['+JSON.stringify(f.name)+']=_f'+i+';');});
    out.push('return Object.freeze(api);','}');
    return {code:out.join('\n')+'\n',next,emitted,reused};
  }
  // String-literal export names prevent ECMAScript keyword collisions.
  fns.forEach((f,i) => {
    if (f.pub) out.push('export { _f' + i + ' as ' + JSON.stringify(f.name) + ' };');
  });
  return {code:out.join('\n')+'\n',next,emitted,reused};
}
// Do not expose a raw prior map: it would grant executable text injection.
export function emitCold(input,externalCount=0){
  return emitScalarIR(input,externalCount,new Map()).code;
}
export class ScalarEmissionSession{
  #memo=new Map();
  emit(input,externalCount=0,{cold=false}={}){
    const r=emitScalarIR(input,externalCount,cold?new Map():this.#memo);
    this.#memo=r.next;
    return {code:r.code,emitted:r.emitted,reused:r.reused};
  }
}
