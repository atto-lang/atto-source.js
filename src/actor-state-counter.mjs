// Checked, intentionally narrow actor-owned state profile for the trusted JS
// worker backend. Consumes already-sanitized lexer tokens from transpile-worker.
// NO guest expressions, arbitrary callbacks, or source text are emitted as JS.
// Exact actor state and guarded mode proof is required before compilation.
const MAX = 9223372036854775807n;

export function compile_actor_state_counter(tokens, fail) {
  let i = 0;
  const peek = () => tokens[i];
  const take = token => peek() === token ? (i++, true) : false;
  const expect = token => { if (!take(token)) fail('E_ACTOR_STATE_SYNTAX'); };
  const ident = () => {
    const name = tokens[i++];
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name ?? '') ||
        ['state', 'self', 'define', 'end', 'receive', 'pub', 'using'].includes(name))
      fail('E_ACTOR_STATE_SYNTAX');
    return name;
  };
  const literal = () => {
    const negative = take('-');
    const token = tokens[i++];
    if (!/^[0-9]+$/.test(token ?? '')) fail('E_ACTOR_STATE_SYNTAX');
    const n = BigInt(token);
    if (n > MAX + BigInt(negative)) fail('E_INT_OVERFLOW');
    return negative ? -n : n;
  };
  const critical = (mode, binder) => {
    expect('self'); expect('.'); expect('handle_state'); expect('(');
    expect('critical'); expect('-'); expect(mode);
    expect('|'); const name = ident(); expect('|');
    expect('-'); expect('>');
    if (binder && name !== binder) fail('E_STATE_BORROW');
    return name;
  };
  expect('define'); expect('actor'); const actor = ident(); expect('as');
  let field = null;
  let hasInitializer = false;
  let initial = 0n;
  let inline = false;
  if (take('state')) {
    inline = true;
    expect('{'); expect('let'); expect('int'); field = ident();
    if (take(':') || take('=')) { initial = literal(); hasInitializer = true; }
    expect(';'); expect('}');
  }

  let initializedOnStart = false;
  let startedValue = 0n;
  if (take('on_start')) {
    initializedOnStart = true;
    expect('('); expect(')'); expect(':'); expect('void');
    expect('using'); expect('state'); expect('.'); expect('write'); expect('{');
    const binder = critical('write');
    expect('{'); expect(binder); expect('.'); const name = ident();
    if (field !== null && name !== field) fail('E_STATE_BORROW');
    if (field === null) field = name;
    expect('='); startedValue = literal(); expect(';'); expect('}');
    expect(')'); expect(';'); expect('}');
  }

  expect('receive'); expect('('); expect('ActorMail'); expect('<'); expect('int'); expect('>');
  const mail = ident(); expect(')'); expect(':'); expect('void');
  expect('using'); expect('state'); expect('.'); expect('read'); expect(',');
  expect('state'); expect('.'); expect('write'); expect('{');
  const writeBinder = critical('write');
  expect('{'); expect(writeBinder); expect('.'); const written = ident();
  if (field !== null && written !== field) fail('E_STATE_BORROW');
  if (field === null) field = written;
  expect('+'); expect('='); expect(mail); expect('.'); expect('value'); expect(';');
  expect('}'); expect(')'); expect(';');
  expect('val'); const observed = ident(); expect('=');
  const readBinder = critical('read');
  expect(readBinder); expect('.'); expect(field); expect(')'); expect(';');
  expect('stdio'); expect('.'); expect('println'); expect('('); expect(observed); expect(')'); expect(';');
  expect('}'); expect('end');

  if (inline && peek() === 'define') fail('E_STATE_DUPLICATE');
  if (!inline) {
    expect('define'); expect('state'); expect('on'); expect('actor');
    if (ident() !== actor) fail('E_STATE_OWNER');
    expect('as'); expect('{'); expect('let'); expect('int');
    if (ident() !== field) fail('E_STATE_BORROW');
    if (take(':') || take('=')) { initial = literal(); hasInitializer = true; }
    expect(';'); expect('}');
  }
  if (!hasInitializer && !initializedOnStart) fail('E_STATE_UNINITIALIZED');
  if (take('pub')) { /* public main, never public actor state */ }
  expect('fnc'); expect('main'); expect('('); expect(')'); expect(':'); expect('int'); expect('{');
  expect('val'); const actorRef = ident(); expect('=');
  expect('spawn'); expect(actor); expect('('); expect(')'); expect(';');
  expect(actorRef); expect('.'); expect('send'); expect('(');
  const sentValue = literal(); expect(')'); expect(';');
  expect('return'); const mainValue = literal(); expect(';'); expect('}');
  if (i !== tokens.length) fail('E_TRAILING_SOURCE');

  // This is a *bounded trusted-JS adapter*, not a general Wasm actor guest.
  // One admitted send is retained until the trusted host calls on_drain();
  // on_message returning is never treated as receiver completion.
  const lines = [
    '// Checked Atto scalar sealed-state Worker profile; no source evaluation.',
    'const MAX=9223372036854775807n,MIN=-9223372036854775808n;',
    'export async function create_tenant({tenant,generation}){',
    ' let started=false,retired=false,draining=false;',
    ` let count=${initial}n;`,
    ' const pending=[];',
    ' const check_live=()=>{if(retired)throw new Error("E_ACTOR_RETIRED");};',
    ' const deliver=(value)=>{',
    '  check_live();',
    '  if(typeof value!=="bigint")throw new Error("E_ROUTE_WIRE");',
    '  const next=count+value;',
    '  if(next>MAX||next<MIN){',
    "   retired=true;pending.length=0;const e=new Error('E_GUEST_PANIC_1');",
    `   e.actor_failure={kind:'panic',actor_id:1,parent_id:0,actor_type:'${actor}',reason:'E_GUEST_PANIC_1'};`,
    '   throw e;',
    '  }',
    '  count=next;',
    "  return {value:'delivered',stdout:String(count)+'\\n',actors:1};",
    ' };',
    ' return {',
    '  async on_message(){',
    '   check_live();if(started)throw new Error("E_MAIN_ALREADY_CALLED");',
    `   count=${initializedOnStart ? startedValue : initial}n;started=true;`,
    `   pending.push(${sentValue}n);`,
    `   return {value:'${mainValue}',stdout:'',actors:1};`,
    '  },',
    '  async on_drain(){',
    '   check_live();if(!started)throw new Error("E_GUEST_NOT_READY");',
    '   if(draining)throw new Error("E_STATE_REENTRANT");',
    '   draining=true;let stdout="";let processed=0;',
    '   try{while(pending.length){',
    '    const result=deliver(pending[0]);pending.shift();stdout+=result.stdout;processed++;',
    '   }}finally{draining=false;}',
    "   return {value:'drained',stdout,actors:1,processed};",
    '  },',
    '  async on_route({actor_id,wire_type,buffer}){',
    '   check_live();if(!started)throw new Error("E_GUEST_NOT_READY");',
    '   if(draining||pending.length)throw new Error("E_ADMISSION_PENDING");',
    '   if(actor_id!==1)throw new Error("E_ACTOR_REF");',
    "   if(wire_type!=='i64'||!(buffer instanceof ArrayBuffer)||buffer.byteLength!==8)",
    "    throw new Error('E_ROUTE_WIRE');",
    '   return deliver(new DataView(buffer).getBigInt64(0,true));',
    '  },',
    '  async on_stop(){retired=true;pending.length=0;return {stopped:true};}',
    ' };',
    '}',
    ''
  ];
  return {backend:'js',trusted:true,guest_abi:'atto.js.browser.actor-state-counter-preview.v1',
    module_source:lines.join('\n')};
}
