import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileToIR,compileIR} from '../src/compiler.mjs';
const corpus=JSON.parse(readFileSync(new URL('./fixtures/collection-subtypes-v1-candidate.json',import.meta.url),'utf8'));
const guest=async source=>import('data:text/javascript;base64,'+Buffer.from(compileIR(compileToIR(source))).toString('base64'));
const main=body=>'pub fnc main():int{'+body+'}';
const root='define class StringMap<V> extends Map<String,V> as pub count():int{return self.size();} pub plus(int n):int{return self.count()+n;} end ';
const child='define class Scores extends StringMap<int> as pub bonus():int{return self.plus(40);} end ';
test('exact shared multilevel Map candidate',async()=>{
  const v=corpus.cases.find(v=>v.id==='map_multilevel');
  assert.equal((await guest(v.source)).main(),BigInt(v.expected.value));
});
test('closed specialization and inherited calls execute actual ESM',async()=>{
  const m=await guest(root+child+main('const Scores s={"a":1,"b":2};return s.bonus();'));
  assert.equal(m.main(),42n);
  assert.equal((await guest(root+main('const StringMap<int> s={"a":1,"b":2};return s.plus(40);'))).main(),42n);
  assert.equal((await guest(root+'define class Middle<T> extends StringMap<T> as end '+ 'define class Scores extends Middle<int> as end '+main('const Scores s={"a":1};return s.plus(41);'))).main(),42n);
});
test('bad substitutions and inherited overrides fail before IR',()=>{
  for(const declaration of [
    'define class Scores extends StringMap as end ',
    'define class Scores extends StringMap<bool> as end ',
    'define class Scores extends StringMap<int,int> as end ',
    'define class Scores<T> extends StringMap<int> as end ',
    'define class Scores extends StringMap<int> as pub count():int{return 0;} end '
  ])assert.throws(()=>compileToIR(root+declaration+main('return 42;')),/E_MAP_SUBTYPE_(GENERIC|METHOD)/);
  for(const body of ['const StringMap s={};return 42;','const StringMap<bool> s={};return 42;'])
    assert.throws(()=>compileToIR(root+main(body)),/E_MAP_SUBTYPE_GENERIC/);
});
test('no recursive or forward self method references in bounded profile',()=>{
  for(const member of ['pub bad():int{return self.bad();}','pub bad():int{return self.later();} pub later():int{return 42;}'])
    assert.throws(()=>compileToIR('define class Scores extends Map<String,int> as '+member+' end '+main('return 42;')),/E_MAP_SUBTYPE_METHOD/);
});
