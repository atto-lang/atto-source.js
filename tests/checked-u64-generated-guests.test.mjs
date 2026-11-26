import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToCheckedU64IRV1 as lower,compileCheckedU64IRV1 as emit,compileCheckedU64ScalarV1 as compile} from '../src/checked-u64-scalar-v1.mjs';

const MAX=(1n<<64n)-1n;
const M=0xffffffffn;
let state=0x9e3779b97f4a7c15n;
function next(){state^=(state<<13n)&MAX;state^=state>>7n;state^=(state<<17n)&MAX;return state;}
const checked=n=>n<0n||n>MAX?null:n;
const cases=[];
for(let i=0;i<256;i++){
  const a=next(),b=next(),c=next();
  const x=a&M,y=b&M;
  cases.push({family:'add',expr:`op(${a},${i%2===0?MAX-a:b})`,op:'+',expected:checked(a+(i%2===0?MAX-a:b))});
  cases.push({family:'subtract',expr:`op(${a},${i%2===0?a:b})`,op:'-',expected:checked(a-(i%2===0?a:b))});
  cases.push({family:'multiply',expr:`op(${i%2===0?x:a},${i%2===0?y:b})`,op:'*',expected:checked((i%2===0?x:a)*(i%2===0?y:b))});
  const p=checked(x*y),q=checked(p+c);
  cases.push({family:'intermediate',expr:`first(42,op(${x},${y})+${c})`,op:'*',expected:q===null?null:42n});
}
for(const family of ['add','subtract','multiply','intermediate']){
  test(`256 compiled generated u64 guests: ${family}`,async()=>{
    let values=0,faults=0;
    for(const [i,row] of cases.filter(x=>x.family===family).entries()){
      const source=`pub fnc main():uint{return ${row.expr};} fnc op(u64 a,uint b):u64{return a${row.op}b;} fnc first(uint a,u64 b):uint{return a;}`;
      const ir=JSON.parse(JSON.stringify(lower(source)));
      const js=emit(ir);
      assert.equal(compile(source),js,`${family} ${i}: source/IR artifact mismatch`);
      const guest=await import('data:text/javascript,'+encodeURIComponent(js));
      if(row.expected===null){
        assert.throws(()=>guest.main(),e=>e instanceof RangeError&&e.code==='integer_overflow',`${family} ${i}: expected fault`);faults++;
      }else{assert.equal(guest.main(),row.expected,`${family} ${i}: result`);values++;}
    }
    assert.equal(values+faults,256);
    assert.ok(values>0&&faults>0,`${family} must exercise values and faults`);
    console.log(`${family}: ${values} values, ${faults} expected faults`);
  });
}
