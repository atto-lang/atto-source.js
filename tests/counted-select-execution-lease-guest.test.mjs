import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compileCountedReadyV1} from '../src/counted-select-ready-compiler.mjs';
import {SelectContinuationFence} from '../src/select-continuation-fence.mjs';

test('actual emitted counted-ready guest joins its physical drivers on success and failure',async()=>{
  const proto=SelectContinuationFence.prototype;
  const claim=proto.tryClaim,close=proto.close;
  const claims=[],closures=[];
  proto.tryClaim=function(ticket){
    const lease=claim.call(this,ticket);
    assert.ok(lease);
    assert.equal(this.advance(this.generation),false);
    claims.push({fence:this,ticket,lease});
    return lease;
  };
  proto.close=function(){
    closures.push({fence:this,executing:this.executing});
    return close.call(this);
  };
  const dir=await mkdtemp(join(process.cwd(),'.counted-lease-'));
  try{
    const positive=await readFile(new URL('./fixtures/select-source-v2/counted-three.atto',import.meta.url),'utf8');
    const ok=join(dir,'ok.mjs');await writeFile(ok,compileCountedReadyV1(positive));
    const guest=await import(pathToFileURL(ok));
    assert.equal(await guest.main(),42n);
    assert.equal(await guest.main(),42n);
    const negative='suspends fnc main(): int { val Channel<int> a = Channel.new<int>(1); writech a, 42; val Future<Array<int>> pending = select<int>(1) { when readch a: int n -> { return n; } }; val int overflow = 9223372036854775807 + 1; val Array[int] b = await pending; return b[0]; }';
    const bad=join(dir,'bad.mjs');await writeFile(bad,compileCountedReadyV1(negative));
    await assert.rejects((await import(pathToFileURL(bad))).main(),/E_I64_OVERFLOW/);
    assert.equal(closures.length,3);
    assert.equal(new Set(closures.map(x=>x.fence)).size,3);
    assert.equal(closures[0].executing,0);
    assert.equal(closures[1].executing,0);
    assert.equal(closures[2].executing,1);
    assert.ok(claims.length>=3);
    for(const {fence,ticket,lease} of claims){
      assert.equal(fence.retirementReady,true);
      assert.equal(fence.executing,0);
      assert.equal(fence.pendingTickets,0);
      assert.equal(ticket.active,false);
      assert.equal(lease.active,false);
      assert.equal(fence.tryConsume(ticket),false);
    }
  }finally{
    proto.tryClaim=claim;proto.close=close;
    await rm(dir,{recursive:true,force:true});
  }
});
