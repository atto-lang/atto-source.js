import test from "node:test";
import assert from "node:assert/strict";
import {parseStrictJsonReport} from "../src/parity-json-strict.mjs";

const parse=source=>parseStrictJsonReport(source,262144,"parity");
test("JSON scanner rejects malformed escapes and literal control bytes in keys and values",()=>{
 for(const source of [
  '"bad\\x20escape"','"bad\\v"', '"\\u000g"','"\\u000"',
  '{"key\\x31":1}', '{"valid":"raw\nline"}',
  '{"key\tname":true}', '{"ok":"raw\u0000nul"}',
  '{"a":"slash\\"}', '{"a":"bad\\z"}'
 ])assert.throws(()=>parse(source),/invalid JSON report/,JSON.stringify(source));
});
test("valid escaped controls remain legal JSON data with exact decoding",()=>{
 for(const source of [
  '"line\\nnext"','"nul\\u0000ok"','{"\\u0009":1}',
  '{"payload":"\\\\","quoted":"\\""}',
  '{"snowman":"☃","rocket":"🚀"}'
 ])assert.deepEqual(parse(source),JSON.parse(source),source);
});
