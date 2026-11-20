import test from "node:test";
import assert from "node:assert/strict";
import {parseStrictJsonReport} from "../src/parity-json-strict.mjs";
const parse=source=>parseStrictJsonReport(source,262144,"parity");

test("JSON member identity preserves distinct valid Unicode normalization forms",()=>{
 const composed="\u00e9",decomposed="e\u0301";
 const raw=JSON.stringify({[composed]:1,[decomposed]:2,
   payload:{"rocket🚀":"{}[]\\\"","simple":"é😀"}});
 const actual=parse(raw);
 assert.deepEqual(actual,JSON.parse(raw));
 assert.deepEqual(Object.keys(actual).slice(0,2),[composed,decomposed]);
});

test("escaped aliases of identical decoded Unicode members cannot bypass duplicate detection",()=>{
 for(const source of [
  '{"e\\u0301":1,"é":2}',
  '{"\\u00e9":1,"é":2}',
  '{"\\ud83d\\ude80":1,"🚀":2}',
  '{"nested":{"e\\u0301":1,"é":2}}'
 ])assert.throws(()=>parse(source),/duplicate JSON member/,source);
 const distinct='{"é":1,"e\\u0301":2}';
 assert.deepEqual(parse(distinct),JSON.parse(distinct));
});
