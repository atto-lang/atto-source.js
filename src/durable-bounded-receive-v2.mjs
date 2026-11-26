import {compile_durable_bounded_codec_v2} from './durable-bounded-codec-v2.mjs';
// Deliberately restricted source profile. No general parser admission, IO,
// actor scheduler, mailbox authority or side effects. The broker must bind
// the compiled artifact and schema to a trusted, exclusive turn permit.
const tokens=/[A-Za-z_][A-Za-z_0-9]*|[0-9]+|""|->|[<>{}():;=+.]/gy;
const canonical='define durable actor Ledger as state count : int = 0 ; state name : string = "" ; receive ( ActorMail < string > mail ) -> void { self . count = self . count + 1 ; self . name = mail . value ; } end'.split(' ');
const reject=()=>{throw new Error('E_DURABLE_BOUNDED_RECEIVE_V2');};
export function compile_durable_bounded_receive_v2(source){
 if(typeof source!=='string'||source.length>16384)reject();
 // New scanner per invocation, exact contiguous tokens; no source text emitted.
 const lexer=new RegExp(tokens.source,tokens.flags);let p=0,i=0;
 while(p<source.length){
  const c=source[p];if(c===' '||c==='\r'||c==='\n'||c==='\t'){p++;continue;}
  lexer.lastIndex=p;const t=lexer.exec(source);if(!t||t[0]!==canonical[i++])reject();p=lexer.lastIndex;
 }
 if(i!==canonical.length)reject();
 const codec=compile_durable_bounded_codec_v2('Ledger',[{name:'count',type:'int'},{name:'name',type:'string'}]);
 return {...codec,guest_abi:'atto.js.durable.bounded-receive.v2.draft',module_source:codec.module_source+`
export function atto_initial_state_v2(){return atto_encode_state_v2(0n,'');}
// The restricted compiled receive increments count and replaces name. Both
// operations stage in a fresh snapshot; no publication happens in the guest.
export function atto_receive_v2(checkpoint,mail){
 const [count]=atto_decode_state_v2(checkpoint);
 if(count<0n||count===(1n<<63n)-1n)deny();
 return atto_encode_state_v2(count+1n,mail);
}
`};
}
