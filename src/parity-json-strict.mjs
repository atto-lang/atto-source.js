/**
 * Bound and validate externally supplied parity JSON before materializing it.
 * Duplicate keys (including escaped aliases), nonfinite numbers and excessive
 * nesting/complexity are rejected. This does not authenticate report provenance.
 */
export function parseStrictJsonReport(text,maximum,where) {
  if(typeof text!=='string'||!Number.isSafeInteger(maximum)||maximum<0||
     Buffer.byteLength(text,'utf8')>maximum)
    throw Error(where+': missing or oversized JSON report');
  // If a fractional decimal rounds to a safe integer, downstream integer
  // schemas cannot tell it apart from an actual integer. Inspect the original
  // decimal's exponent and trailing digits before trusting that coercion.
  const exactDecimalInteger=token=>{
    const match=/^-?([0-9]+)(?:[.]([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(token);
    if(!match)return false;
    const fractional=match[2]??'';
    const significant=(match[1]+fractional).replace(/^0+/,'');
    if(!significant)return true;
    const places=Number(match[3]??'0')-fractional.length;
    if(places>=0)return true;
    const missing=-places;
    if(!Number.isFinite(missing)||missing>significant.length)return false;
    for(let i=significant.length-missing;i<significant.length;i++)
      if(significant[i]!=='0')return false;
    return true;
  };
  let at=0,values=0;
  const fail=reason=>{throw Error(where+': '+reason);};
  const invalid=()=>fail('invalid JSON report');
  const spaces=()=>{while(at<text.length&&/[ \t\r\n]/.test(text[at]))at++;};
  function quoted() {
    if(text[at]!=='"')invalid();
    const start=at++;
    while(at<text.length) {
      const ch=text[at++];
      if(ch==='"') {
        try {return JSON.parse(text.slice(start,at));}
        catch {invalid();}
      }
      if(ch==='\\')at++;
    }
    invalid();
  }
  function value(depth) {
    if(depth>64||++values>20000)fail('JSON report depth or complexity exceeded');
    spaces();
    if(text[at]==='{') {
      at++;spaces();
      const seen=new Set();
      if(text[at]==='}') {at++;return;}
      for(;;) {
        spaces();
        const key=quoted();
        // Do not admit prototype-magic names into downstream receipt merges.
        if(key==='__proto__'||key==='constructor'||key==='prototype')
          fail('unsafe JSON member');
        if(seen.has(key))fail('duplicate JSON member');
        seen.add(key);
        spaces();
        if(text[at++]!==':')invalid();
        value(depth+1);
        spaces();
        if(text[at]===','){at++;continue;}
        if(text[at]==='}'){at++;return;}
        invalid();
      }
    }
    if(text[at]==='[') {
      at++;spaces();
      if(text[at]===']'){at++;return;}
      for(;;) {
        value(depth+1);
        spaces();
        if(text[at]===','){at++;continue;}
        if(text[at]===']'){at++;return;}
        invalid();
      }
    }
    if(text[at]==='"') {quoted();return;}
    const start=at;
    while(at<text.length&&!/[,}\]\x20\t\r\n]/.test(text[at]))at++;
    const token=text.slice(start,at);
    if(token==='true'||token==='false'||token==='null')return;
    if(!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(token))invalid();
    const number=Number(token);
    if(!Number.isFinite(number))fail('non-finite JSON number');
    // Signed zero (including negative underflow) is lossy in JSON receipts.
    // Reject it before JSON.parse can materialize ambiguous numeric metadata.
    if(token.startsWith('-') && number===0)
      fail('noncanonical negative-zero JSON number');
    // A nonzero significand rounding to zero must not become a trusted zero.
    if(number===0 && /[1-9]/.test(token.split(/[eE]/,1)[0]))
      fail('underflow JSON number');
    // A rounded fractional input can also look like a safe integer (e.g.
    // 1.0000000000000001 -> 1). Preserve the integer admission boundary.
    if(Number.isInteger(number)){
      if(!Number.isSafeInteger(number))
        fail('unsafe JSON integer precision');
      if(!exactDecimalInteger(token))
        fail('lossy fractional JSON integer');
    }
  }
  value(0);spaces();
  if(at!==text.length)invalid();
  // Only admitted, bounded text reaches full object/array materialization.
  try {return JSON.parse(text);}
  catch {invalid();}
}
