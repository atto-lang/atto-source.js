import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {compileProgramV2} from '../src/program-v2.mjs';

// These are real SOURCE-LEVEL compiler mutations: clone the compiler and its
// two import dependencies within this source-repository test runner's private
// temp directory, change one exact compiler codegen rule, and compile again.
// Never mirror these private sources across organizations or publish mutants.
const compilerUrl=new URL('../src/program-v2.mjs',import.meta.url);
const sourceFiles=[
  ['program-v2.mjs',new URL('../src/program-v2.mjs',import.meta.url)],
  ['program-ir-v2.mjs',new URL('../src/program-ir-v2.mjs',import.meta.url)],
  ['execution-domain-admission.mjs',
    new URL('../src/execution-domain-admission.mjs',import.meta.url)]
];
function replaceUnique(src,needle,replacement) {
  const start=src.indexOf(needle);
  assert.notEqual(start,-1,'compiler mutation anchor missing: '+needle);
  assert.equal(src.indexOf(needle,start+needle.length),-1,
    'compiler mutation anchor not unique: '+needle);
  const mutant=src.slice(0,start)+replacement+src.slice(start+needle.length);
  assert.notEqual(mutant,src);
  return mutant;
}
async function withMutatedCompiler(needle,replacement,run) {
  const original=await readFile(compilerUrl,'utf8');
  const mutated=replaceUnique(original,needle,replacement);
  const dir=await mkdtemp(join(tmpdir(),'atto-compiler-mutant-'));
  try{
    for(const [name,url] of sourceFiles) {
      const source=name==='program-v2.mjs'
        ? mutated : await readFile(url,'utf8');
      await writeFile(join(dir,name),source,{mode:0o600});
    }
    const compiler=await import(pathToFileURL(join(dir,'program-v2.mjs')).href);
    assert.equal(typeof compiler.compileProgramV2,'function');
    await run(compiler.compileProgramV2);
  }finally{
    await rm(dir,{recursive:true,force:true});
  }
}
async function importChecked(code,id) {
  const syntax=spawnSync(process.execPath,['--input-type=module','--check'],{
    input:code,encoding:'utf8',timeout:10000,maxBuffer:1024*1024
  });
  assert.equal(syntax.error,undefined,id+' syntax checker spawn');
  assert.equal(syntax.status,0,id+' invalid final ESM: '+syntax.stderr);
  return import('data:text/javascript;charset=utf-8,'+
    encodeURIComponent(code)+'#compiler-mutation-'+encodeURIComponent(id));
}
const cases=[
  {
    id:'missing-generator-symbol-helper',
    needle:'(program.generators??[]).some(gen=>gen.yields.some(usesSymbol))||',
    replacement:'false||',
    source:'pub gen* values():Iterator<int>{yield #ready eq #ready ? 42 : 0;return;}',
    check:async(good,bad)=>{
      assert.deepEqual(good.values().next(),{value:42n,done:false});
      assert.throws(()=>bad.values().next(),ReferenceError);
    }
  },
  {
    id:'missing-generator-option-helper',
    needle:'(program.generators??[]).some(gen=>gen.yields.some(usesPortableRuntime))||',
    replacement:'false||',
    source:'pub gen* values():Iterator<int>{yield Option.unwrap_or(Option.some(42),0);return;}',
    check:async(good,bad)=>{
      assert.equal(good.values().next().value,42n);
      assert.throws(()=>bad.values().next(),ReferenceError);
    }
  },
  {
    id:'missing-generator-result-helper',
    needle:'(program.generators??[]).some(gen=>gen.yields.some(usesPortableRuntime))||',
    replacement:'false||',
    source:'pub gen* values():Iterator<int>{yield Result.unwrap_or(Result.ok(42),0);return;}',
    check:async(good,bad)=>{
      assert.equal(good.values().next().value,42n);
      assert.throws(()=>bad.values().next(),ReferenceError);
    }
  },
  {
    id:'reversed-named-function-abi',
    needle:"expr.paramOrder.forEach((slot,i)=>{formal[slot]='_named'+i;});",
    replacement:"expr.paramOrder.forEach((slot,i)=>{formal[i]='_named'+i;});",
    source:'fnc digits(int a,int b):int{return a*10+b;} '+
      'pub fnc main():int{return digits(b:2,a:4);}',
    check:async(good,bad)=>{
      assert.equal(good.main(),42n);
      assert.equal(bad.main(),24n);
    }
  },
  {
    id:'reversed-named-method-abi',
    needle:"expr.paramOrder.forEach((slot,i)=>{formal[slot]='_namedMethod'+i;});",
    replacement:"expr.paramOrder.forEach((slot,i)=>{formal[i]='_namedMethod'+i;});",
    source:'pub define class Box as pub mtd digits(self,int a,int b):int{return a*10+b;} end '+
      'pub fnc main():int{return new Box().digits(b:2,a:4);}',
    check:async(good,bad)=>{
      assert.equal(good.main(),42n);
      assert.equal(bad.main(),24n);
    }
  },
  {
    id:'delayed-generator-parameter-check',
    needle:"    // boundary must reject invalid inputs at invocation, not on first pull.\n    params.forEach(p=>out.push('_check('+p+');'));",
    replacement:"    // boundary must reject invalid inputs at invocation, not on first pull.",
    source:'pub gen* values(int x):Iterator<int>{yield x;return;}',
    check:async(good,bad)=>{
      assert.throws(()=>good.values(42),/BigInt required/);
      const accepted=bad.values(42);
      assert.equal(typeof accepted.next,'function');
      assert.throws(()=>accepted.next(),/BigInt required/);
    }
  },
  {
    id:'dropped-function-param-check',
    needle:"out.push(check+'('+p+');');",
    replacement:"out.push(';');",
    source:'pub fnc ignore(int x):int{return 42;}',
    check:async(good,bad)=>{
      assert.throws(()=>good.ignore(7),/BigInt required/);
      assert.equal(bad.ignore(7),42n);
    }
  },
  {
    id:'dropped-checked-i64-overflow',
    needle:'if(v<-(1n<<63n)||v>(1n<<63n)-1n)',
    replacement:'if(false)',
    source:'pub fnc next(int x):int{return x+1;}',
    check:async(good,bad)=>{
      const max=(1n<<63n)-1n;
      assert.throws(()=>good.next(max),/ORES_I64_OVERFLOW/);
      assert.equal(bad.next(max),max+1n);
    }
  },
  {
    id:'dropped-remainder-zero-diagnostic',
    needle:'if(b===0n)',
    replacement:'if(false)',
    source:'pub fnc main():int{return 1%0;}',
    check:async(good,bad)=>{
      assert.throws(()=>good.main(),/ORES_I64_DIVISION_BY_ZERO/);
      assert.throws(()=>bad.main(),e=>e instanceof RangeError&&
        !e.message.includes('ORES_I64_DIVISION_BY_ZERO'));
    }
  },
  {
    id:'dropped-public-function-return-check',
    needle:"out.push('return '+check+'('+emitExpr(fn.body)+');','}');",
    replacement:"out.push('return '+emitExpr(fn.body)+';','}');",
    source:'pub fnc main():int{return 42;}',
    check:async(good,bad,goodCode,badCode)=>{
      const goodInjected=replaceUnique(goodCode,'return _check(42n);',
        'return _check(42);');
      const badInjected=replaceUnique(badCode,'return 42n;','return 42;');
      const g=await importChecked(goodInjected,'guarded-fn-number');
      const b=await importChecked(badInjected,'unguarded-fn-number');
      assert.throws(()=>g.main(),/BigInt required/);
      assert.equal(b.main(),42);
      assert.equal(good.main(),42n);
      assert.equal(bad.main(),42n);
    }
  },
  {
    id:'dropped-public-method-return-check',
    needle:"out.push('return '+check+'('+emitExpr(method.body)+');');",
    replacement:"out.push('return '+emitExpr(method.body)+';');",
    source:'pub define class Box as pub mtd main(self):int{return 42;} end',
    check:async(good,bad,goodCode,badCode)=>{
      const goodInjected=replaceUnique(goodCode,'return _check(42n);',
        'return _check(42);');
      const badInjected=replaceUnique(badCode,'return 42n;','return 42;');
      const g=await importChecked(goodInjected,'guarded-method-number');
      const b=await importChecked(badInjected,'unguarded-method-number');
      assert.throws(()=>new g.Box().main(),/BigInt required/);
      assert.equal(new b.Box().main(),42);
      assert.equal(new good.Box().main(),42n);
      assert.equal(new bad.Box().main(),42n);
    }
  },
  {
    id:'dropped-class-receiver-brand',
    needle:'if(this===null||(typeof this!=="object"&&typeof this!=="function")||!(#oresBrand in this))',
    replacement:'if(false)',
    source:'pub define class Box as pub mtd read(self):int{return 42;} end',
    check:async(good,bad)=>{
      assert.throws(()=>good.Box.prototype.read.call({}),/invalid Oreslang receiver/);
      assert.equal(bad.Box.prototype.read.call({}),42n);
    }
  }
];
test('12 compiler mutations each use a bounded, pinned single-edit source path',()=>{
  assert.equal(cases.length,12);
  assert.equal(new Set(cases.map(c=>c.id)).size,12);
  assert.equal(new Set(cases.map(c=>c.needle)).size,11);
});
for(const c of cases){
  test('actual codegen source mutation detected / '+c.id,async()=>{
    const normalCode=compileProgramV2(c.source);
    await withMutatedCompiler(c.needle,c.replacement,async mutatedCompiler=>{
      const mutantCode=mutatedCompiler(c.source);
      assert.notEqual(mutantCode,normalCode,'compiler source mutation undetected');
      const normal=await importChecked(normalCode,c.id+'-normal');
      const mutant=await importChecked(mutantCode,c.id+'-mutant');
      await c.check(normal,mutant,normalCode,mutantCode);
    });
  });
}
