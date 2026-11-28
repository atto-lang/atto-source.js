import test from 'node:test';
import assert from 'node:assert/strict';
import {compileVerifiedStrict} from '../src/program-v2.mjs';
const source=body=>'type Counter = int where self >= 0 and self <= 100; pub fnc main() -> int { '+body+' }';
for(const [id,body] of [
 ['increment','let int x=40; set x++; set ++x; return x;'],
 ['decrement','let int x=44; set x--; set --x; return x;'],
 ['compound','let int x=20; set x+=2; set x-=1; set x*=2; return x;'],
 ['plain','let int x=40; set x=x+2; return x;'],
 ['wrapped','let int x=40; set! (x=x+2); return x;'],
 ['loop','let Counter x=0; while x < 42 { set x++; } return x;'],
 ['legacy','let int x=40; x=x+2; return x;'],
])test(id,async()=>{
 const code=compileVerifiedStrict(source(body));
 const guest=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
 assert.equal(guest.main(),42n);
});
for(const [id,body,diagnostic] of [
 ['fixed','val int x=40; set x++; return x;',/E_VERIFY_UNSUPPORTED/],
 ['unknown','set missing++; return 42;',/E_VERIFY_UNSUPPORTED/],
 ['overflow','let int x=9223372036854775807; set x++; return x;',/E_VERIFY_UNPROVEN/],
 ['compound-gap','let int x=40; set x + = 2; return x;',/E_SYNTAX/],
 ['double-increment','let int x=40; set ++x++; return x;',/E_SYNTAX/],
 ['range','let Counter x=100; set x++; return x;',/E_REFINEMENT_BINDING/],
])test(id,()=>assert.throws(()=>compileVerifiedStrict(source(body)),diagnostic));
