import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2,compileProgramIRV2} from '../src/program-v2.mjs';
const main=body=>'pub fnc main():int{'+body+'}';
async function guest(body,options){
 const source=main(body),ir=compileToProgramIRV2(source,options),esm=compileProgramV2(source,options);
 assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(ir)),options),esm);
 return import('data:text/javascript,'+encodeURIComponent(esm));
}
test('pending scalar result is selected before cleanup, including caret return',async()=>{
 for(const [body,expected] of [
 ['let int n=42;return sync task<int>{defer n=99;return n;};',42n],
 ['let int n=42;val int r=sync task<int>{defer n=99;return n;};return r*100+n;',4299n],
 ['let int n=42;val int r=sync task<int>{defer n=7;defer n=99;^ n;};return r*100+n;',4207n],
 ['let int n=42;let int v=7;val int r=sync task<int>{defer n=v;v=99;return n;};return r*100+n;',4299n],
 ['let int n=42;val int r=sync task<int>{defer n=99;return n+1;};return r*100+n;',4399n]
 ])assert.equal((await guest(body)).main(),expected);
});
test('cleanup on ordinary failure is not a successful return replacement',async()=>{
 const body='let int n=0;val Option<int> missing=None;val Result<int,Error> r=trap! sync task<int>{defer n=42;return missing.unwrap();};return r.is_err()?n:99;';
 assert.equal((await guest(body)).main(),42n);
});
test('cleanup body cannot return into the exiting task and unsupported recovery fails closed',()=>{
 for(const body of [
 'let int n=42;return sync task<int>{defer {return 99;} return n;};',
 'return sync task<int>{recover |err,c| -> {return 99;};return 42;};'
 ])assert.throws(()=>compileProgramV2(main(body)),/error:/);
});
