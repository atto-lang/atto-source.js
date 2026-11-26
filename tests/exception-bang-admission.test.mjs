import test from 'node:test';
import assert from 'node:assert/strict';
import {compile as compileScalar} from '../src/compiler.mjs';
import {compileProgramV2} from '../src/program-v2.mjs';

// Both JS source compilers must fail before host JavaScript can impersonate
// a typed AttoLang Error/Result, unwind, or supervisor CONTROL transition.
for (const op of ['trap!', 'throw!', 'raise!', 'panic!']) {
  test('JS scalar and program-v2 fail closed on '+op,()=>{
    const source='fnc main():int{return '+op+' value;}';
    assert.throws(()=>compileScalar(source),/EXCEPTION_BANG_BACKEND_UNSUPPORTED/);
    assert.throws(()=>compileProgramV2(source),/EXCEPTION_BANG_BACKEND_UNSUPPORTED/);
  });
}

test('comments and identifier substrings are not exceptional control',()=>{
  const source='fnc main():int{return 42;} // trap! throw! raise! panic!';
  assert.doesNotThrow(()=>compileScalar(source));
  assert.doesNotThrow(()=>compileProgramV2(source));
});


test('all canonical exceptional-bang spellings are rejected in both unlowered JS source frontends',()=>{
  // Source-only lex/admission target from atto-spec #146. A rejection means
  // safe unimplemented behavior, never a compiled guest parity PASS.
  const positive=[
    'trap! parse_id("42")',
    'throw! Error("bad")','raise! Error("bad")',
    'panic! Error("bad")'
  ];
  for(const expr of positive){
    const source='fnc main():int{return '+expr+';}';
    for(const compile of [compileScalar,compileProgramV2])
      assert.throws(()=>compile(source),/EXCEPTION_BANG_BACKEND_UNSUPPORTED/,
        'unlowered guest effect admitted: '+expr);
  }
});

test('non-exceptional bang collisions cannot trigger an exceptional-control denial',()=>{
  // These are intentionally NOT required to compile in restricted scalar JS.
  // They must only avoid an incorrectly interpreted exceptional keyword.
  const negative=[
    'trap parse_id("42")','throw Error("bad")',
    'raise Error("bad")','panic Error("bad")',
    'trap !ready','trap!=next','trap!eq next',
    'trapped! parse_id()','copy! owned'
  ];
  for(const expr of negative){
    const source='fnc main():int{return '+expr+';}';
    for(const compile of [compileScalar,compileProgramV2]){
      try{compile(source);}
      catch(e){assert.doesNotMatch(String(e),/EXCEPTION_BANG_BACKEND_UNSUPPORTED/,
        'comparison/identifier was misread as exceptional control: '+expr);}
    }
  }
});

test('quoted and commented exception spellings do not change executable JS guest admission',()=>{
  const samples=[
    'fnc main():int{return 42;} // trap! throw! raise! panic!',
    'fnc main():int{/* trap! throw! raise! panic! */return 42;}'
  ];
  for(const source of samples)
    for(const compile of [compileScalar,compileProgramV2])
      assert.doesNotThrow(()=>compile(source),'comment changed guest: '+source);
});

for (const keyword of ['trap!','throw!','raise!','panic!','copy!','copy!!','take!','move!','borrow!','share!','pin!','drop!','pipe!','rpipe!','stop!','expand!']) {
  test('mandatory whitespace after '+keyword,()=>{
    for(const tail of ['value','(42)','/*comment*/ value','', '\u00a0value']) {
      const source='fnc main():int{return '+keyword+tail+';}';
      for(const compile of [compileScalar,compileProgramV2])
        assert.throws(()=>compile(source),/E_BANG_KEYWORD_WHITESPACE/,source);
    }
  });
}

test('move! is a contextual ownership denial, not an untyped call',()=>{
  for(const compile of [compileScalar,compileProgramV2]) {
    assert.throws(()=>compile('fnc main():int{return move! value;}'),/OWNERSHIP_BANG_BACKEND_UNSUPPORTED/);
    assert.throws(()=>compile('fnc main():int{return move!! value;}'),/E_BANG_KEYWORD_WHITESPACE/);
  }
});
