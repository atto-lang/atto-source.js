import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {compileProgramV2} from '../src/program-v2.mjs';

const PIN='e56dfccea11757ff18fc72a81ba5d643380e69184ab309eedf45e1e7b940e133';
const HEADER='// oreslang:checked-i64-v1\n';
const DEFINITIONS=[
  'fnc sum(int a,int b): int {return a+b;}',
  'fnc subtract(int a,int b): int {return a-b;}',
  'fnc multiply(int a,int b): int {return a*b;}',
  'fnc opposite(int a): int {return -a;}',
  'fnc remainder(int a,int b): int {return Integer.rem(a,b);}'
].join('\n');
const source=expr=>HEADER+DEFINITIONS+'\npub fnc main(): int {return '+expr+';}\n';

async function cases(){
  const bytes=await readFile(new URL('../contracts/checked-i64-java-js-v1/cases.tsv',import.meta.url));
  assert.ok(bytes.length>0&&bytes.length<=16384,'bounded corpus');
  assert.equal(createHash('sha256').update(bytes).digest('hex'),PIN,'SHA-256 corpus identity');
  const raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  assert.ok(raw.endsWith('\n')&&!raw.includes('\r'),'canonical LF');
  const lines=raw.trimEnd().split('\n');
  assert.equal(lines.length,15,'exact case count');
  const seen=new Set(),parsed=[];
  for(const line of lines){
    const cells=line.split('|');
    assert.equal(cells.length,4,'canonical tabulation');
    const [id,kind,expression,expected]=cells;
    assert.match(id,/^[a-z]+(?:-[a-z]+)*$/);
    assert.ok(!seen.has(id),'duplicate case '+id);
    seen.add(id);
    assert.ok(['value','overflow','zero'].includes(kind),'unknown outcome');
    assert.match(expression,/^[A-Za-z0-9(),+ -]{1,160}$/,'bounded source expression');
    if(kind==='value') assert.match(expected,/^(?:0|-?[1-9][0-9]*)$/);
    else assert.equal(expected,kind==='overflow'?'ORES_I64_OVERFLOW':'DIVISION_BY_ZERO');
    parsed.push({id,kind,expression,expected});
  }
  return parsed;
}

test('checked-i64 Java/JS fixture source is unchanged and has distinct outcomes',async()=>{
  const all=await cases();
  assert.equal(all.filter(c=>c.kind==='value').length,7);
  assert.equal(all.filter(c=>c.kind==='overflow').length,7);
  assert.equal(all.filter(c=>c.kind==='zero').length,1);
});

test('compiled JS program-v2 executes all exact-source scalar outcomes',async()=>{
  for(const c of await cases()){
    const emitted=compileProgramV2(source(c.expression));
    const mod=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(emitted));
    if(c.kind==='value') assert.equal(mod.main(),BigInt(c.expected),c.id);
    if(c.kind==='overflow') assert.throws(()=>mod.main(),
      e=>e instanceof RangeError&&e.message.startsWith('ORES_I64_OVERFLOW:'),c.id);
    if(c.kind==='zero') assert.throws(()=>mod.main(),
      e=>e instanceof RangeError&&e.message.startsWith('ORES_I64_DIVISION_BY_ZERO:'),c.id);
  }
});

test('checked profile selector cannot be spoofed, duplicated or displaced',async()=>{
  const body=DEFINITIONS+'\npub fnc main(): int {return 42;}\n';
  for(const bad of [
    ' '+HEADER+body, '\n'+HEADER+body,
    '//oreslang:checked-i64-v1\n'+body,
    '//  oreslang:checked-i64-v1\n'+body,
    '// oreslang:checked-i64-v2\n'+body,
    '// oreslang:checked-i64-v1 trailing\n'+body,
    HEADER+HEADER+body,
    HEADER+body+HEADER
  ]) assert.throws(()=>compileProgramV2(bad),/checked-i64-v1:/);
  assert.doesNotThrow(()=>compileProgramV2(HEADER+
    '/* outer /* // oreslang:checked-i64-v2 */ nested */\n'+body));
  assert.doesNotThrow(()=>compileProgramV2(HEADER+body));
});

test('out-of-range literals never become runtime-wrapped integers',()=>{
  const src=HEADER+'pub fnc main(): int {return 9223372036854775808;}';
  assert.throws(()=>compileProgramV2(src),/outside|range|invalid|literal/i);
});
