import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2} from '../src/program-v2.mjs';

// This suite exercises the actual JS program-v2 compiler and generated ESM
// guest values, not a lexical acceptance oracle.
async function guest(source) {
  return await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(compileProgramV2(source)));
}

test('two guard spellings agree on true/false continuation and return', async () => {
  const module = await guest(`
    pub fnc brace(bool present): int {
      guard present { return 0; }
      return 42;
    }
    pub fnc keyword(bool present): int {
      guard present else
        return 0;
      end
      return 42;
    }
  `);
  for(const present of [true,false]){
    assert.equal(module.brace(present),present?42n:0n);
    assert.equal(module.keyword(present),module.brace(present));
  }
});

test('comma-separated guards short-circuit through typed conditions', async () => {
  const module=await guest(`
    pub fnc choose(bool a,bool b): int {
      guard a,b else
        return 0;
      end
      return 42;
    }
  `);
  assert.equal(module.choose(true,true),42n);
  assert.equal(module.choose(false,true),0n);
  assert.equal(module.choose(true,false),0n);
});

test('keyword guard nests inside outer keyword if without stealing its else',async()=>{
  const module=await guest(`
    pub fnc choose(bool a,bool b): int {
      if a then
        guard b else
          return 7;
        end
      else
        return 9;
      fi
      return 42;
    }
  `);
  assert.equal(module.choose(true,true),42n);
  assert.equal(module.choose(true,false),7n);
  assert.equal(module.choose(false,true),9n);
});

test('approved optional_port example parses and retains result type',()=>{
  assert.doesNotThrow(()=>compileProgramV2(`
    pub fnc optional_port(bool present): Option<int> {
      guard present else
        return None;
      end
      return Some(8080);
    }
  `));
});

test('bad guard exits, types and delimiters fail closed at compile time',()=>{
  for(const source of [
    'pub fnc main():int { guard true else end return 42; }',
    'pub fnc main():int { guard true else if true then return 1; fi end return 42; }',
    'pub fnc main():int { guard true { return 0; } else return 1; end return 42; }',
    'pub fnc main():int { guard true else return 0; fi return 42; }',
    'pub fnc main():int { guard 17 else return 0; end return 42; }',
    'pub fnc main():int { guard true return 0; return 42; }',
    'pub fnc main():int { guard true else throw Error("bad"); end return 42; }',
    'pub fnc main():int { loop { guard false { break; } return 42; } return 0; }',
    'pub fnc main():int { loop { guard false else continue; end return 42; } return 0; }',
  ]) assert.throws(()=>compileProgramV2(source),/error: program v2:/,source);
});
