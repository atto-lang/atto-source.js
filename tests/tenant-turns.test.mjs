import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {createCompiler} from '../src/canonical-browser-compiler.mjs';
import {runCanonicalGuest,runTenantGuest,MAX_TENANT_MAIL,MAX_TENANT_MEMORY} from '../src/canonical-actor-runtime.mjs';
import {createTurnQueue} from '../src/tenant-turn-queue.mjs';
const compiler=await createCompiler(await readFile(new URL('../test-support/canonical-compiler.wasm',import.meta.url)));
async function compile(source){const r=compiler.compile(source,'javascript');assert.equal(r.ok,true,JSON.stringify(r.diagnostics));return import('data:text/javascript,'+encodeURIComponent(r.esm));}
const actor=`define actor A as let int n = 0; receive(ActorMail<int> mail): void { self.n = self.n + mail.value; stdio.println(self.n); return; } end`;
test('MessageChannel yields a host task and preserves continuation FIFO',async()=>{
 const q=createTurnQueue(),order=[];try{
  const a=q.yieldTurn().then(()=>order.push('a')),b=q.yieldTurn().then(()=>order.push('b'));
  await Promise.resolve().then(()=>order.push('microtask'));assert.deepEqual(order,['microtask']);
  await Promise.all([a,b]);assert.deepEqual(order,['microtask','a','b']);
 }finally{q.close();}
});
test('closing a tenant queue cancels outstanding and future continuations',async()=>{
 const q=createTurnQueue();const pending=q.yieldTurn();q.close();q.close();
 await assert.rejects(pending,/E_TASK_CANCELLED/);await assert.rejects(q.yieldTurn(),/E_TASK_CANCELLED/);
});
test('source actors round-robin within a tenant with per-actor FIFO, in sync and task-turn hosts',async()=>{
 const guest=await compile(actor+` pub fnc main(): int {val a=spawn A();val b=spawn A();a.send(1);a.send(2);b.send(10);b.send(20);return 42;}`);
 const a=runCanonicalGuest(guest),b=await runTenantGuest(guest);assert.deepEqual(a,b);
 assert.equal(b.stdout,'1\n10\n3\n30\n');assert.equal(b.turns,4);assert.equal(b.privateMemories,3);
});
test('aggregate guest memory admission rejects before allocating the over-budget actor',()=>{
 let allocations=0;const held=[];
 const guest={actorNames:['A'],instantiate(atto){allocations++;held.push(atto);return {exports:{memory:new WebAssembly.Memory({initial:16,maximum:16}),main(){for(let i=0;i<16;i++)atto.actor_spawn(0);return 0n;},actor_init(){},actor_receive(){},panic_code:{value:0}}};}};
 const r=runCanonicalGuest(guest);assert.equal(r.ok,false);assert.match(r.message,/E_TENANT_MEMORY/);assert.equal(r.tenantMemoryBytes,MAX_TENANT_MEMORY);assert.equal(allocations,16);
 assert.throws(()=>held[0].actor_spawn(0),/E_TENANT_CLOSED/);
});
test('a single backing store cannot be reused for two actor instances',()=>{
 const memory=new WebAssembly.Memory({initial:1,maximum:1});
 const r=runCanonicalGuest({actorNames:['A'],instantiate:atto=>({exports:{memory,main(){atto.actor_spawn(0);return 0n;},actor_init(){},actor_receive(){}}})});
 assert.equal(r.ok,false);assert.match(r.message,/E_MEMORY/);
});
test('source mail respects the aggregate tenant cap across actor inboxes',async()=>{
 const guest=await compile(actor+` pub fnc main(): int {val a=spawn A();val b=spawn A();val c=spawn A();for(let i=0;i<10000;i++){a.send(1);b.send(1);}c.send(1);return 0;}`);
 const r=runCanonicalGuest(guest);assert.equal(MAX_TENANT_MAIL,20000);assert.equal(r.ok,false);assert.match(r.message,/E_TENANT_MAIL/);assert.equal(r.turns,0);
});
test('actor panic preserves prior output, identifies the actor and fails its tenant',async()=>{
 const guest=await compile(`define actor A as receive(ActorMail<int> mail): void {stdio.println(7);val x=9223372036854775807;stdio.println(x+mail.value);return;} end pub fnc main(): int {val a=spawn A();a.send(1);return 0;}`);
 const r=await runTenantGuest(guest);assert.equal(r.ok,false);assert.equal(r.stdout,'7\n');assert.match(r.message,/integer overflow in actor A#0/);
});
