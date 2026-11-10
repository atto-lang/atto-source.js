import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStrictJsonReport} from '../src/parity-json-strict.mjs';

const parse=text=>parseStrictJsonReport(text,262144,'Java');

test('accepts pretty reports, escaped strings, arrays and distinct nested keys',()=>{
  const source=' {"backend":"graal", "results":[ {"id":"a\\\"b", "observed_exit":42}, {"id":"a\\\"b", "observed_exit":43} ], "meta":{"id":"independent"}} ';
  assert.deepEqual(parse(source),JSON.parse(source));
});

test('rejects duplicate names anywhere, including escaped key aliases',()=>{
  for(const source of [
    '{"backend":"js","backend":"graal"}',
    '{"backend":"js","\\u0062ackend":"graal"}',
    '{"results":[{"id":"one","id":"two"}]}',
    '{"results":[{"meta":{"x":1,"x":2}}]}',
    '{"results":[{"meta":{"a\\u0022b":1,"a\\\"b":2}}]}',
    '{"results":[{"meta":{"\\uD83D\\uDE00":1,"😀":2}}]}'
  ])assert.throws(()=>parse(source),/duplicate JSON member/,source);
});

test('preserves size, invalid JSON, and depth/complexity budgets',()=>{
  assert.throws(()=>parseStrictJsonReport(3,10,'JS'),/missing or oversized/);
  assert.throws(()=>parseStrictJsonReport(' '.repeat(10),9,'JS'),/missing or oversized/);
  for(const source of ['{"a":}', '{"a":1,}', '[1,]','{'])
    assert.throws(()=>parse(source),/invalid JSON report/);
  assert.throws(()=>parse('['.repeat(65)+'0'+']'.repeat(65)),/depth or complexity exceeded/);
  const many='['+Array.from({length:20001},()=> '0').join(',')+']';
  assert.throws(()=>parse(many),/depth or complexity exceeded/);
});

test('accepts exact depth and value-count limits and rejects the next value',()=>{
  const depth64='['.repeat(64)+'0'+']'.repeat(64);
  assert.deepEqual(parse(depth64),JSON.parse(depth64));
  const maximum='['+Array(19999).fill('0').join(',')+']';
  assert.equal(parse(maximum).length,19999); // array itself is value 1
  assert.throws(()=>parse('['+Array(20000).fill('0').join(',')+']'),
    /depth or complexity exceeded/);
});

test('resource limits reject before full object-graph JSON parsing',()=>{
  const original=JSON.parse;
  let calls=0;
  const oversized=[
    '['.repeat(65)+'0'+']'.repeat(65),
    '['+Array(20000).fill('0').join(',')+']'
  ];
  try {
    JSON.parse=function(text,...rest){calls++;return original(text,...rest);};
    for(const source of oversized)
      assert.throws(()=>parse(source),/depth or complexity exceeded/);
    assert.equal(calls,0,'oversized arrays must not be materialized before admission');
  } finally {JSON.parse=original;}
});

test('rejects nonfinite numeric materialization and non-JSON lexical shortcuts',()=>{
  for(const source of ['1e999','-1e999','{"result":1e309}'])
    assert.throws(()=>parse(source),/non-finite JSON number/);
  for(const source of ['01','+1','.5','1.','[truefalse]','[1\u00a0]','[null:]'])
    assert.throws(()=>parse(source),/invalid JSON report/);
  for(const source of ['0','1.25','-2.5e-10','true','false','null'])
    assert.deepEqual(parse(source),JSON.parse(source));
  for(const maximum of [NaN,Infinity,-1,1.5])
    assert.throws(()=>parseStrictJsonReport('{}',maximum,'JS'),/missing or oversized/);
});

test('byte admission counts UTF-8 bytes for valid Unicode',()=>{
  for(const source of ['"😀"','"é"']) {
    const bytes=Buffer.byteLength(source,'utf8');
    assert.deepEqual(parseStrictJsonReport(source,bytes,'JS'),JSON.parse(source));
    assert.throws(()=>parseStrictJsonReport(source,bytes-1,'JS'),/missing or oversized/);
  }
});

test('bounded seeded JSON round trips agree with the platform parser',()=>{
  let seed=0x5917c0de;
  const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  const strings=['','quote"','slash\\','line\nend','😀','é','\\u0061','__proto__'];
  const make=depth=>{
    const choice=next()%(depth?6:4);
    if(choice===0)return null;
    if(choice===1)return (next()&1)!==0;
    if(choice===2)return ((next()%20001)-10000)/8;
    if(choice===3)return strings[next()%strings.length];
    if(choice===4)return Array.from({length:next()%5},()=>make(depth-1));
    const result=Object.create(null);
    const length=next()%5;
    for(let i=0;i<length;i++)result['key-'+i+'-'+strings[next()%strings.length]]=make(depth-1);
    return result;
  };
  for(let i=0;i<512;i++) {
    const source=JSON.stringify(make(5));
    assert.deepEqual(parse(source),JSON.parse(source));
  }
});

test('reject lossy numeric parity JSON integers before JSON.parse materialization',()=>{
  for(const source of ['9007199254740992','9007199254740993',
    '-9007199254740993','1e20','-9.007199254740993e15'])
    assert.throws(()=>parse(source),/unsafe JSON integer precision/,source);
  for(const source of ['9007199254740991','-9007199254740991',
    '1.5','-2.5e-10'])
    assert.deepEqual(parse(source),JSON.parse(source));
});

test('negative-zero and signed-underflow report numbers fail before materialization',()=>{
  for(const source of ['-0','-0.0','-0e6','-1e-999','{"observed":-0}']){
    assert.throws(()=>parse(source),/noncanonical negative-zero JSON number/,source);
  }
  for(const source of ['0','0.0','0e6','1.5','-2.5e-10']){
    assert.deepEqual(parse(source),JSON.parse(source));
  }
});

test('reject nonzero positive subnormal underflow before JSON report materialization',()=>{
  for(const source of ['1e-324','0.1e-999','{"cases":[{"weight":1e-324}]}'])
    assert.throws(()=>parse(source),/underflow JSON number/,source);
  for(const source of ['0e-999','0.00e-999','5e-324','{"weight":0}'])
    assert.deepEqual(parse(source),JSON.parse(source),source);
});

test('signed subnormal underflow and representable values remain distinct',()=>{
  for(const source of ['-1e-324','-0.01e-999','{"values":[-1e-324]}','[0,1e-324]'])
    assert.throws(()=>parse(source),/(?:noncanonical negative-zero|underflow JSON number)/,source);
  for(const source of ['-5e-324','5e-324','0.000e-999','{"numbers":[-5e-324,5e-324,0]}'])
    assert.deepEqual(parse(source),JSON.parse(source),source);
});

test('quoted numeric labels remain text while unsafe numeric tokens are rejected',()=>{
  for(const source of [
    '{"note":"-0","detail":"1e-324"}',
    '["-0","1e-324"]',
    '{"note":"\\u0031e-324","numeric":0}',
    '{"count":1E+3}',
    '{"count":1e-3}'
  ])assert.deepEqual(parse(source),JSON.parse(source),source);
  for(const source of [
    '{"n":-0}', '{"n":1e-324}', '{"n":1e}',
    '{"n":+1}', '{"n":00}', '[0,1e-324]'
  ])assert.throws(()=>parse(source),undefined,source);
});

test('prototype-magic JSON report members are denied at every depth',()=>{
  for(const key of ['__proto__','constructor','prototype']){
    for(const source of [
      '{"'+key+'":1}',
      '{"results":[{"'+key+'":true}]}',
      '{"\\u005f\\u005fproto\\u005f\\u005f":1}'
    ].filter((_,i)=>i!==2||key==='__proto__'))
      assert.throws(()=>parse(source),/unsafe JSON member/,source);
  }
  assert.deepEqual(parse('{"backend":"llvm","results":[{"case":"ok"}]}'),
    {backend:'llvm',results:[{case:'ok'}]});
});

test('prototype-sensitive JSON keys fail closed after decoding',()=>{
  for(const [key,escaped] of [
    ['__proto__','\\u005f\\u005fproto\\u005f\\u005f'],
    ['constructor','constr\\u0075ctor'],
    ['prototype','proto\\u0074ype']
  ]){
    for(const source of [
      '{"'+key+'":1}',
      '{"results":[{"'+key+'":true}]}',
      '{"'+escaped+'":1}',
      '{"results":[{"'+escaped+'":true}]}'
    ])assert.throws(()=>parse(source),/unsafe JSON member/,source);
  }
  assert.deepEqual(parse('{"backend":"llvm","results":[{"case":"ok"}]}'),
    {backend:'llvm',results:[{case:'ok'}]});
});

test('fractional JSON tokens cannot round into trusted safe integer metadata',()=>{
  for(const source of [
    '1.0000000000000001',
    '0.99999999999999999',
    '9007199254740991.4',
    '-9007199254740991.4',
    '{"run_id":1.0000000000000001}',
    '[0.99999999999999999,1]',
    '1.0000000000000000000001e0'
  ])assert.throws(()=>parse(source),/lossy fractional JSON integer/,source);
  for(const source of [
    '1.0','15e0','1.5e1','1.000e2','0.00e-999',
    '1.25','0.125','-2.5e-10','9007199254740991.0'
  ])assert.deepEqual(parse(source),JSON.parse(source),source);
});

test('unsafe object keys never reach full JSON graph materialization',()=>{
  const original=JSON.parse;
  let objectsParsed=0;
  try {
    JSON.parse=function(source,...args){
      if(source.trimStart().startsWith('{'))objectsParsed++;
      return original(source,...args);
    };
    for(const source of [
      '{"__proto__":{"unsafe":true}}',
      '{"results":[{"constr\\u0075ctor":1}]}',
      '{"nested":{"proto\\u0074ype":"forged"}}'
    ])assert.throws(()=>parse(source),/unsafe JSON member/,source);
    assert.equal(objectsParsed,0,'unsafe reports must be rejected before object-graph parsing');
    assert.deepEqual(parse('{"label":"__proto__","backend":"llvm"}'),
      {label:'__proto__',backend:'llvm'});
    assert.equal(objectsParsed,1,'safe report must still be materialized');
  } finally {JSON.parse=original;}
});


test('reject lone JSON UTF-16 surrogates before report materialization',()=>{
 for(const source of [
  '"\\ud800"','"\\udc00"','{"value":"\\ud800"}',
  '{"\\udc00":1}','{"id":"\\ud83d\\u0041"}',
  '{"value":"\ud800"}','{"value":"\udc00"}'
 ])assert.throws(()=>parse(source),/invalid JSON Unicode surrogate/,source);
 for(const source of ['"\\ud83d\\ude80"','{"rocket":"🚀"}','{"\\ud83d\\ude00":42}'])
  assert.deepEqual(parse(source),JSON.parse(source),source);
});
