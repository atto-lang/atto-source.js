import test from 'node:test';
import assert from 'node:assert/strict';
import {startsBareSequence, readSequence, readCallArguments} from '../src/sequence-syntax.mjs';
const fail = message => { throw new SyntaxError(message); };
// Minimal token cursor exercising the real delimiter helper, not the compiler.
class Cursor {
  constructor(source) {
    this.ts = [...source.matchAll(/\w+|[^\s]/g)].map(([value]) => ({
      value, kind: /^[a-z]/.test(value) ? 'id' : /^\d/.test(value) ? 'int' : 'sym'
    }));
    this.ts.push({value:'<eof>',kind:'eof'});
    this.pos=0;
  }
  peek(){return this.ts[this.pos];}
  match(v){if(this.peek().value!==v)return false;this.pos++;return true;}
  expect(v){if(!this.match(v))fail('expected '+v);}
  expr(){
    if(this.match('seq')){this.expect('(');return readSequence(this,true,fail);}
    if(this.match('(')){this.expect('>');return readSequence(this,true,fail);}
    const at=this.peek();
    if(at.kind==='int'){this.pos++;return Number(at.value);}
    if(at.kind==='id'){this.pos++;this.expect('(');return {call:at.value,args:readCallArguments(this,fail)};}
    fail('expected expression');
  }
}
const seq=(...items)=>({kind:'seq',items});
const args=source=>{const p=new Cursor(source);const out=readCallArguments(p,fail);assert.equal(p.peek().kind,'eof');return out;};
test('bare final argument owns its commas and preceding arguments remain separate',()=>{
  assert.deepEqual(args('seq 1,2,42)'),[seq(1,2,42)]);
  assert.deepEqual(args('9,seq 1,2,42)'),[9,seq(1,2,42)]);
  assert.deepEqual(args('seq(1,2),42)'),[seq(1,2),42]);
  assert.deepEqual(args('(>1,2),42)'),[seq(1,2),42]);
});
test('nested calls and grouped expressions retain their own delimiters',()=>{
  assert.deepEqual(args('7,seq f(1,2),seq(3,4),42)'),[7,seq({call:'f',args:[1,2]},seq(3,4),42)]);
  assert.deepEqual(args('f(seq 1,2),42)'),[{call:'f',args:[seq(1,2)]},42]);
});
test('bare return stops before its terminator; grouped return consumes its close',()=>{
  const p=new Cursor('seq 1,2,42;');assert.ok(startsBareSequence(p));p.pos++;
  assert.deepEqual(readSequence(p,false,fail),seq(1,2,42));assert.equal(p.peek().value,';');
  const q=new Cursor('seq(1,2,42)');assert.ok(!startsBareSequence(q));
  assert.deepEqual(q.expr(),seq(1,2,42));assert.equal(q.peek().kind,'eof');
});
test('empty, dangling, mismatched and over-budget sequences reject',()=>{
  for(const source of ['seq )','seq 1,)','seq ,42)','seq 1;42)','seq(1,),42)','seq '+Array(129).fill('1').join(',')+')'])
    assert.throws(()=>args(source),SyntaxError,source);
  assert.equal(args('seq '+Array(128).fill('1').join(',')+')')[0].items.length,128);
  assert.throws(()=>args(Array(129).fill('1').join(',')+')'),/argument limit/);
});
