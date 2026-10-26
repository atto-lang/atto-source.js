import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compileProgramIRV2,
  compileProgramV2,
  compileToProgramIRV2
} from '../src/program-v2.mjs';
import {validateProgramIRV2} from '../src/program-ir-v2.mjs';

const errorCode=(source,code)=>{
  assert.throws(
    ()=>compileToProgramIRV2(source),
    error=>String(error?.message||error).includes(code),
    source
  );
};

test('explicit source export produces stable binding without creating a new ESM export',async()=>{
  const privateSource='fnc api():int{return 42;}';
  const explicitSource='export fnc api; fnc api():int{return 42;}';

  const privateEsm=compileProgramV2(privateSource);
  const explicitEsm=compileProgramV2(explicitSource);
  assert.equal(explicitEsm,privateEsm,
    'explicit source export must not alter the JS host/ESM export surface');

  const ir=compileToProgramIRV2(explicitSource);
  assert.equal(ir.sourceExportBindings.length,1);
  assert.deepEqual(ir.sourceExportBindings[0],{
    ownerNamespaceId:'$root',
    localSymbolId:'$root::fnc::api',
    localKind:'fnc',
    localName:'api',
    externalName:'api',
    scope:'public',
    origin:'explicit_export'
  });

  const ns=await import('data:text/javascript;charset=utf-8,'+
    encodeURIComponent(explicitEsm)+'#explicit-source-export');
  assert.deepEqual(Object.keys(ns),[]);
});

test('explicit source aliases preserve one local identity and still do not create ESM aliases',async()=>{
  const source=[
    'export fnc internal as first;',
    'export fnc internal as second;',
    'fnc internal():int{return 7;}'
  ].join('\n');

  const ir=compileToProgramIRV2(source);
  assert.equal(ir.sourceExportBindings.length,2);
  assert.equal(ir.sourceExportBindings[0].localSymbolId,
    ir.sourceExportBindings[1].localSymbolId);
  assert.deepEqual(ir.sourceExportBindings.map(x=>x.externalName),['first','second']);

  const ns=await import('data:text/javascript;charset=utf-8,'+
    encodeURIComponent(compileProgramV2(source))+'#source-aliases');
  assert.deepEqual(Object.keys(ns),[]);
});

test('root/module aliases and scoped exports preserve emitted ESM, not host API',async()=>{
  const baseline=[
    'fnc internal():int{return 42;}',
    'define module Service as',
    '  fnc hidden():int{return 7;}',
    'end'
  ].join('\n');
  const variants=[
    {
      scope:'public', external:'public_helper',
      source:'export fnc internal as public_helper;\n'+baseline
    },
    {
      scope:'file', external:'file_helper',
      source:'export[file] fnc internal as file_helper;\n'+baseline
    },
    {
      scope:'pkg', external:'package_helper',
      source:'export[pkg] fnc internal as package_helper;\n'+baseline
    },
    {
      scope:'public', external:'service_hidden',
      source:baseline.replace('  fnc hidden():int',
        '  export fnc hidden as service_hidden;\n  fnc hidden():int')
    },
    {
      scope:'public', external:'second_helper',
      source:'export fnc internal as public_helper;\n'+
        'export fnc internal as second_helper;\n'+baseline
    }
  ];
  const original=compileProgramV2(baseline);
  for(const {scope,external,source} of variants){
    const ir=compileToProgramIRV2(source);
    assert.ok(ir.sourceExportBindings.some(x=>
      x.externalName===external && x.scope===scope &&
      x.localSymbolId.endsWith('::fnc::'+(external==='service_hidden'?'hidden':'internal'))));
    const transpiled=compileProgramV2(source);
    assert.equal(transpiled,original,
      'source exports must never change generated ESM code for '+external);
    const namespace=await import('data:text/javascript;charset=utf-8,'+
      encodeURIComponent(transpiled)+'#source-boundary-'+external);
    assert.deepEqual(Object.keys(namespace),[],
      'source alias must not publish JS module host exports');
  }
});

test('inline pub plus identical explicit export is one idempotent source binding',()=>{
  const ir=compileToProgramIRV2(
    'export fnc api; pub fnc api():int{return 1;}'
  );
  assert.equal(ir.sourceExportBindings.length,1);
  assert.equal(ir.sourceExportBindings[0].origin,'implicit_pub');
  assert.equal(ir.sourceExportBindings[0].externalName,'api');
  assert.match(compileProgramV2(
    'export fnc api; pub fnc api():int{return 1;}'
  ),/export \{/);
});

test('explicit export scopes remain source metadata only',()=>{
  const pkg=compileToProgramIRV2(
    'export[pkg] fnc api; fnc api():int{return 1;}'
  );
  const file=compileToProgramIRV2(
    'export[file] fnc api; fnc api():int{return 1;}'
  );
  assert.equal(pkg.sourceExportBindings[0].scope,'pkg');
  assert.equal(file.sourceExportBindings[0].scope,'file');
  assert.equal(compileProgramV2(
    'export[pkg] fnc api; fnc api():int{return 1;}'
  ),compileProgramV2('fnc api():int{return 1;}'));
});

test('program-v2 export resolver rejects binding conflicts with canonical categories',()=>{
  errorCode(
    'export class api; fnc api():int{return 1;}',
    'EXPORT_KIND_MISMATCH'
  );
  errorCode(
    'export fnc A as Public; export fnc B as Public; '+
      'fnc A():int{return 1;} fnc B():int{return 2;}',
    'EXPORT_ALIAS_COLLISION'
  );
  errorCode(
    'export[pkg] fnc api; pub fnc api():int{return 1;}',
    'EXPORT_SCOPE_CONFLICT'
  );
  errorCode(
    'export fnc f; pub fnc f():int{return 1;} fnc f(int x):int{return x;}',
    'EXPORT_OVERLOAD_VISIBILITY_CONFLICT'
  );
  errorCode(
    'export fnc missing; fnc keep():int{return 1;}',
    'EXPORT_UNKNOWN_TARGET'
  );
});

test('symbol remains contextual when exported as an ordinary binding name',()=>{
  const ir=compileToProgramIRV2(
    'export symbol as PublicSymbol; fnc symbol():int{return 1;}'
  );
  assert.equal(ir.sourceExportBindings.length,1);
  assert.equal(ir.sourceExportBindings[0].localName,'symbol');
  assert.equal(ir.sourceExportBindings[0].externalName,'PublicSymbol');
  assert.equal(ir.sourceExportBindings[0].localKind,'fnc');
});

test('program-v2 export grammar uses stable hardened diagnostics',()=>{
  const keep='fnc keep():int{return 1;}';
  for(const [source,code] of [
    ['export X\n'+keep,'EXPORT_SEMICOLON_REQUIRED'],
    ['export {}; '+keep,'EXPORT_EMPTY_GROUP'],
    ['export class {}; '+keep,'EXPORT_EMPTY_GROUP'],
    ['export actor {,X}; '+keep,'EXPORT_MALFORMED_LIST'],
    ['export actor {X,,Y}; '+keep,'EXPORT_MALFORMED_LIST'],
    ['export actor {X Y}; '+keep,'EXPORT_MALFORMED_LIST'],
    ['export actor {{X}}; '+keep,'EXPORT_NESTED_GROUP'],
    ['export *; '+keep,'EXPORT_WILDCARD_UNSUPPORTED'],
    ["export * from './dep'; "+keep,'EXPORT_REEXPORT_UNSUPPORTED'],
    ["export from './dep' {X}; "+keep,'EXPORT_REEXPORT_UNSUPPORTED'],
    ['export dep.X; '+keep,'EXPORT_QUALIFIED_TARGET_UNSUPPORTED'],
    ['export dep::X; '+keep,'EXPORT_QUALIFIED_TARGET_UNSUPPORTED'],
    ['export Foo<int>; '+keep,'EXPORT_GENERIC_TARGET_UNSUPPORTED'],
    ['export foo(int); '+keep,'EXPORT_CALLABLE_SIGNATURE_UNSUPPORTED'],
    ['export {class X, actor Y}; '+keep,'EXPORT_KIND_PREFIX_IN_GROUP'],
    ['export actor {actor X}; '+keep,'EXPORT_KIND_PREFIX_IN_GROUP'],
    ['export symbol #ready as Ready; '+keep,'EXPORT_SYMBOL_BINDING_ALIAS_UNSUPPORTED'],
    ['export symbol #ready as #ok; '+keep,'EXPORT_SYMBOL_IDENTITY_MISMATCH'],
    ['export symbol ready as #ready; '+keep,'EXPORT_SYMBOL_IDENTITY_TARGET_REQUIRES_SYMBOL_SOURCE'],
    ['export[pkg][file] X; '+keep,'EXPORT_MULTIPLE_SCOPES'],
    ['export[project] X; '+keep,'EXPORT_UNKNOWN_SCOPE'],
    ["export string ready as 'ready'; "+keep,'EXPORT_UNKNOWN_DECLARATION_KIND'],
    ["export const ready as 'ready'; "+keep,'EXPORT_LITERAL_ALIAS_UNSUPPORTED'],
    ['export class Foo as "foo"; '+keep,'EXPORT_LITERAL_ALIAS_UNSUPPORTED']
  ]) errorCode(source,code);
});

test('class and executable local exports fail with source-scope category',()=>{
  errorCode(
    'define class Bad as export fnc nope; end',
    'EXPORT_LOCAL_SCOPE'
  );
  errorCode(
    'fnc bad():int{export fnc nope; return 1;}',
    'EXPORT_LOCAL_SCOPE'
  );
});

test('direct program IR cannot forge source export identity, origin, or target',()=>{
  const good=compileToProgramIRV2(
    'export fnc api; fnc api():int{return 1;}'
  );
  assert.deepEqual(validateProgramIRV2(good),good);

  const mutate=edit=>{
    const copy=JSON.parse(JSON.stringify(good));
    edit(copy);
    return copy;
  };
  for(const bad of [
    mutate(ir=>{ir.sourceExportBindings[0].localSymbolId='$root::fnc::other';}),
    mutate(ir=>{ir.sourceExportBindings[0].localName='missing';}),
    mutate(ir=>{ir.sourceExportBindings[0].origin='implicit_pub';}),
    mutate(ir=>{ir.sourceExportBindings[0].scope='pkg';ir.functions[0].pub=true;}),
    mutate(ir=>{ir.sourceExportBindings.push({...ir.sourceExportBindings[0]});})
  ]) assert.throws(()=>compileProgramIRV2(bad),/error: program IR:/);
});

test('source export binding validation never invokes hostile declaration getters',()=>{
  const good=compileToProgramIRV2(
    'export fnc api; fnc api():int{return 1;}'
  );
  const hostile={...good};
  const fn={};
  let invoked=false;
  Object.defineProperty(fn,'module',{
    enumerable:true,
    get(){invoked=true;throw Error('getter invoked');}
  });
  for(const [key,value] of Object.entries(good.functions[0])){
    if(key==='module')continue;
    Object.defineProperty(fn,key,{enumerable:true,value});
  }
  hostile.functions=[fn];

  assert.throws(()=>validateProgramIRV2(hostile),/accessor/);
  assert.equal(invoked,false);
});
