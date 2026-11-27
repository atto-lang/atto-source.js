import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileToProgramIRV2,compileProgramIRV2} from '../src/program-v2.mjs';
const main=b=>'pub fnc main():int{'+b+'}';
async function run(body){const source=main(body);const js=compileProgramV2(source);assert.equal(compileProgramIRV2(JSON.parse(JSON.stringify(compileToProgramIRV2(source)))),js);return (await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(js))).main();}
test('checked unwrap commits earlier writes, skips later writes and preserves RHS atomicity',async()=>{
 for(const b of [
 'let int n=0;val Option<int> missing=None;val Result<int,Error> r=trap! sync task<int>{n=n+2;val int v=missing.unwrap();n=n+100;return v;};guard r.is_err(),n eq 2{return 1;}return n+40;',
 'let int n=42;val Option<int> missing=None;val Result<int,Error> r=trap! sync task<int>{n=missing.unwrap();return 1;};guard r.is_err(){return 1;}return n;',
 'let int n=0;val Option<int> present=Option.some(40);val int r=sync task<int>{n=2;return present.unwrap();};return n+r;',
 'let int n=2;val Result<int,int> good=Result.ok(40);val int r=sync task<int>{return good.unwrap();};return n+r;',
 'let int n=42;val Result<int,int> bad=Result.err(7);val Result<int,Error> r=trap! sync task<int>{return bad.unwrap();};guard r.is_err(){return 1;}return n;'
 ])assert.equal(await run(b),42n,b);
});
test('task unwrap is not a general method or host call gate',()=>{
 for(const b of ['val int n=42;return sync task<int>{return n.unwrap();};','return sync task<int>{return unknown.unwrap();};','val Option<int> n=None;return sync task<int>{return n.unwrap(42);};','val Option<int> n=None;return sync task<int>{return n.expect("bad");};','return sync task<int>{return Option.none();};'])assert.throws(()=>compileProgramV2(main(b)),b);
});
