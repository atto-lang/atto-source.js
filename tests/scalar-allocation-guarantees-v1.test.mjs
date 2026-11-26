import test from 'node:test';
import assert from 'node:assert/strict';
import {compile,compileToIR,IncrementalSession} from '../src/compiler.mjs';
import {compileToProgramIRV2} from '../src/program-v2.mjs';
const headers=['define fnc int • forward(int x)','define fnc int <- forward(int x)','define fnc forward(int x) -> int','define fnc forward(int x): int','define fnc forward(int x) : int ->','define int <- forward(int x)','int <- forward(int x)'];
const source=(header,marker='@nocopy')=>marker+'\n'+header+' { return x; }\npub fnc main():int { return forward(42); }';
test('five annotated canonical scalar headers emit equivalent executable ESM',async()=>{
  const code=headers.map(h=>compile(source(h)));
  assert.ok(code.every(s=>s===code[0]));
  for(const s of code){
    const guest=await import('data:text/javascript;base64,'+Buffer.from(s).toString('base64'));
    assert.equal(guest.main(),42n);
  }
});
test('allocation guarantee cannot disappear in JS engine or cache',()=>{
  for(const h of headers)for(const marker of ['@noalloc','@nocopy\n@noalloc','@noalloc\n@nocopy']){
    const src=source(h,marker);
    for(const fn of [compile,compileToIR,s=>new IncrementalSession().build(s)])assert.throws(()=>fn(src),/E_NOALLOC/);
    assert.throws(()=>compileToProgramIRV2(src));
  }
});
test('copy guarantee fails closed on unsupported effects and malformed annotations',()=>{
  assert.throws(()=>compile('@nocopy\nfnc forward(int x):int{return x+1;} pub fnc main():int{return forward(41); }'),/E_NOCOPY/);
  for(const marker of ['@nocopy\n@nocopy','@nocopy(1)','@unknown\n@nocopy'])assert.throws(()=>compile(source(headers[0],marker)));
  assert.throws(()=>compile('pub fnc main():int { @nocopy return 42; }'));
  assert.throws(()=>compile('@nocopy export pub fnc main; fnc main():int{return 42;}'));
  assert.doesNotThrow(()=>compile('pub fnc main():int { /* @noalloc */ return 42; }'));
});

test('abbreviated unannotated headers retain identical emitted bytes',()=>{
  const suffix=' { return data; } pub fnc main():int { return process(42); }';
  for(const marker of ['', '@nocopy\n']){
    const expected=compile(marker+'define fnc int <- process(int data)'+suffix);
    for(const header of ['define int <- process(int data)','int <- process(int data)'])assert.equal(compile(marker+header+suffix),expected);
  }
});

test('warm incremental cache cannot launder an unproven guarantee or poison subsequent builds',async()=>{
  const session=new IncrementalSession();
  const admitted=source(headers[0]);
  const plain=source(headers[0],'');
  const baseline=session.build(admitted).code;
  assert.equal(session.build(plain).code,baseline);
  const denied=[
    [source(headers[0],'@noalloc'),'E_NOALLOC'],
    [source(headers[0],'@nocopy\n@noalloc'),'E_NOALLOC'],
    [admitted.replace('return x;','return x+1;'),'E_NOCOPY'],
    [admitted.replace('pub fnc main()', 'fnc hidden(int x):int{return x*2;} pub fnc main()'),'E_NOCOPY'],
  ];
  for(const [src,diagnostic] of denied){
    assert.throws(()=>session.build(src),new RegExp(diagnostic));
    const recovered=session.build(admitted);
    assert.equal(recovered.code,baseline);
    assert.equal(recovered.emitted,0,'rejection must not poison admitted cache');
    const guest=await import('data:text/javascript;base64,'+Buffer.from(recovered.code).toString('base64'));
    assert.equal(guest.main(),42n);
  }
});
