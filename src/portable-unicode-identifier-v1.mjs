// Portable identifier minimum. Keep source and untrusted IR admission in sync.
// The source scanners retain UTF-16 offsets; read whole Unicode scalars.
const START = /^(?:[A-Za-z_Α-ΡΣ-Ωα-ω〇]|\p{Unified_Ideograph}|(?=\p{Script=Han})\p{L})$/u;
const DIGIT = /^[0-9]$/;
export function identifierCharAt(source, at) {
  const cp=source.codePointAt(at);
  return cp===undefined?'':String.fromCodePoint(cp);
}
export const isIdentifierStart = c => START.test(c);
export const isIdentifierPart = c => START.test(c)||DIGIT.test(c);
export function isIdentifier(value) {
  if(typeof value!=='string'||value.length===0||value.length>128)return false;
  let first=true;
  for(const c of value){
    if(!(first?isIdentifierStart(c):isIdentifierPart(c)))return false;
    first=false;
  }
  return true;
}
