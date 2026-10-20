/**
 * Validate externally supplied parity report JSON before comparing observations.
 * JSON.parse alone silently keeps the last occurrence of duplicate object keys.
 * This lexical second pass rejects duplicates, including escaped aliases, at
 * every nesting level. It is deliberately not provenance authentication.
 */
export function parseStrictJsonReport(text,maximum,where) {
  if(typeof text!=='string'||Buffer.byteLength(text,'utf8')>maximum)
    throw Error(where+': missing or oversized JSON report');
  let parsed;
  try { parsed=JSON.parse(text); }
  catch { throw Error(where+': invalid JSON report'); }

  let at=0,values=0;
  const fail=reason=>{throw Error(where+': '+reason);};
  const spaces=()=>{while(at<text.length&&/[ \t\r\n]/.test(text[at]))at++;};
  function quoted() {
    if(text[at]!=='"')fail('invalid JSON string');
    const start=at++;
    while(at<text.length) {
      const ch=text[at++];
      if(ch==='"')return JSON.parse(text.slice(start,at));
      if(ch==='\\')at++; // JSON.parse has already validated escapes.
    }
    fail('unterminated JSON string');
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
        if(seen.has(key))fail('duplicate JSON member');
        seen.add(key);
        spaces();
        if(text[at++]!==':')fail('invalid JSON object');
        value(depth+1);
        spaces();
        if(text[at]===','){at++;continue;}
        if(text[at]==='}'){at++;return;}
        fail('invalid JSON object');
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
        fail('invalid JSON array');
      }
    }
    if(text[at]==='"') {quoted();return;}
    const start=at;
    while(at<text.length&&!/[,}\]\s]/.test(text[at]))at++;
    if(start===at)fail('invalid JSON value');
  }
  value(0);spaces();
  if(at!==text.length)fail('invalid JSON trailing content');
  return parsed;
}
