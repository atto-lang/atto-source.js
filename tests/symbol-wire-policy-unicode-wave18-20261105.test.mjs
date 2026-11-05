import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSymbolWireV1 as validate,symbolWireEqualV1 as equal,
 stringifySymbolWireV1 as stringify,parseSymbolWireJsonV1 as parse} from '../src/symbol-wire-v1.mjs';

const process=name=>({$symbol:'process',name});
const stable=name=>({$symbol:'stable',name});
const uuid='12345678-1234-4234-9234-123456789abc';

test('stable identity and process identity cannot alias across different kinds',()=>{
 assert.equal(equal(stable(uuid),stable(uuid)),true);
 assert.equal(equal(stable(uuid),process(uuid)),false);
 const copy=validate(stable(uuid));
 assert.ok(Object.isFrozen(copy));
 assert.equal(Object.getPrototypeOf(copy),null);
 assert.equal(copy.name,uuid);
});

test('untrusted-core grants only selected process names, never arbitrary stable symbols',()=>{
 assert.equal(validate(process('ready'),{policy:'untrusted-core'}).name,'ready');
 assert.throws(()=>validate(process('forbidden'),{policy:'untrusted-core'}),/denied by untrusted-core policy/);
 assert.throws(()=>validate(stable(uuid),{policy:'untrusted-core'}),/denied by untrusted-core policy/);
 assert.throws(()=>validate(stable(uuid.toUpperCase())),/canonical lowercase UUID/);
});

test('JSON wire decoding rejects escaped duplicate field identities and retains canonical text',()=>{
 const value=process('ready'),text=stringify(value);
 assert.equal(text,'{"$symbol":"process","name":"ready"}');
 assert.equal(equal(parse(text),value),true);
 const slash=String.fromCharCode(92);
 const duplicate='{"$symbol":"process","name":"ready","na'+slash+'u006de":"error"}';
 assert.throws(()=>parse(duplicate),/duplicate JSON member name/);
});

test('non-NFC input, lone surrogates and getter-backed records are denied',()=>{
 assert.throws(()=>validate(process('e'+String.fromCharCode(0x301))),/already be NFC/);
 assert.throws(()=>validate(process(String.fromCharCode(0xd800))),/unpaired UTF-16 surrogate/);
 const record=process('ready');let reads=0;
 Object.defineProperty(record,'name',{enumerable:true,get(){reads++;return 'ready';}});
 assert.throws(()=>validate(record),/accessor/);
 assert.equal(reads,0);
});
