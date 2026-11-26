import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStrictJsonReport} from '../src/parity-json-strict.mjs';

const parse=text=>parseStrictJsonReport(text,16384,'js');

test('paired escaped Unicode surrogate key equals raw supplementary-codepoint spelling',()=>{
 for(const text of [
  String.raw`{"\uD83D\uDE00":"ok"}`,
  '{"😀":"ok"}',
  String.raw`{"outer":{"\uD83D\uDE00":[1,2,3]}}`
 ])assert.deepEqual(parse(text),JSON.parse(text));
});

test('lone surrogate escapes and raw unpaired units are rejected in keys and values',()=>{
 for(const text of [
  String.raw`{"\uD83D":"invalid"}`,
  String.raw`{"\uDE00":"invalid"}`,
  String.raw`{"ok":"\uD83D"}`,
  String.raw`["\uDE00"]`,
  '{"'+String.fromCharCode(0xd800)+'":0}',
  '{"ok":"'+String.fromCharCode(0xdc00)+'"}'
 ])assert.throws(()=>parse(text),/invalid JSON Unicode surrogate/);
});

test('surrogate pair aliases cannot create duplicate semantic receipt members',()=>{
 for(const text of [
  String.raw`{"\uD83D\uDE00":1,"😀":2}`,
  String.raw`{"meta":{"😀":1,"\uD83D\uDE00":2}}`
 ])assert.throws(()=>parse(text),/duplicate JSON member/);
});