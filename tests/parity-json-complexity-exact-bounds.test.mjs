import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStrictJsonReport} from '../src/parity-json-strict.mjs';

const parse=text=>parseStrictJsonReport(text,Buffer.byteLength(text,'utf8'),'complexity');
const nested=n=>'['.repeat(n)+'0'+']'.repeat(n);
const flat=n=>'['+Array(n).fill('0').join(',')+']';

test('64 nested arrays remain within the exact JSON depth budget',()=>{
 const value=parse(nested(64));
 let cursor=value;
 for(let i=0;i<64;i++){
  assert.equal(cursor.length,1);
  cursor=cursor[0];
 }
 assert.equal(cursor,0);
});

test('65 nested arrays fail before materialization',()=>{
 assert.throws(()=>parse(nested(65)),/JSON report depth or complexity exceeded/);
});

test('20000 total nodes are accepted, 20001 nodes fail closed',()=>{
 // The root array itself consumes one node.
 const accepted=parse(flat(19999));
 assert.equal(accepted.length,19999);
 assert.equal(accepted[0],0);
 assert.equal(accepted.at(-1),0);
 assert.throws(()=>parse(flat(20000)),/JSON report depth or complexity exceeded/);
});
