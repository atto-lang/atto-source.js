import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgramV2,compileVerifiedStrict} from '../src/program-v2.mjs';
const base='define dimension Length; define unit Meter: Length; define unit Centimeter: Length = Meter / 100; define dimension Time; define unit Second: Time; define dimension Mass; define unit Kilogram: Mass;';
const compound='define dimension Velocity = Length / Time; define unit MeterPerSecond: Velocity; define dimension Acceleration = Velocity / Time; define unit MeterPerSecondSquared: Acceleration; define dimension Force = Mass * Acceleration; define unit Newton: Force; define unit Kilonewton: Force = Newton * 1000; define dimension Energy = Force * Length; define unit Joule: Energy; define dimension Power = Energy / Time; define unit Watt: Power; define dimension Area = Length * Length; define unit SquareMeter: Area; define dimension Pressure = Force / Area; define unit Pascal: Pressure;';
const source=(expr,decl=compound)=>base+decl+' type Positive = int where self > 0; pub fnc main() -> int { return '+expr+'; }';
for(const [id,expr] of [
 ['velocity','42<MeterPerSecond>/(1<Meter>/1<Second>)'],
 ['force','42<Newton>/(1<Kilogram>*1<Meter>/1<Second>/1<Second>)'],
 ['energy','42<Joule>/(1<Newton>*1<Meter>)'],
 ['power','42<Watt>/(1<Joule>/1<Second>)'],
 ['pressure','42<Pascal>/(1<Newton>/1<SquareMeter>)'],
 ['scale','42<Kilonewton>.to_unit<Newton>()/1000<Newton>'],
 ['signed','0-(-42<Newton>/1<Newton>)']
]){
 test(id+' actual emitted ESM',async()=>{
   const code=compileProgramV2(source(expr));
   const guest=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
   assert.equal(guest.main(),42n);
 });
}
for(const [id,decl,code] of [
 ['forward','define dimension Force = Mass * Unknown;','E_UNIT_NAME'],
 ['cycle','define dimension Force = Mass * Force;','E_UNIT_NAME'],
 ['dimensionless','define dimension Angle = Length / Length;','E_UNIT_DIMENSION'],
 ['nominal collision','define dimension First = Length / Time; define dimension SecondKind = Length / Time;','E_UNIT_DIMENSION'],
 ['duplicate canonical','define dimension Force = Mass * Length; define unit First: Force; define unit SecondForce: Force;','E_UNIT_DUPLICATE'],
 ['wrong derived scale','define dimension Force = Mass * Length; define unit Bad: Force = Meter * 2;','E_UNIT_DIMENSION'],
 ['exponent','define dimension Huge = '+Array(65).fill('Length').join(' * ')+';','E_UNIT_LIMIT']
])test(id,()=>assert.throws(()=>compileProgramV2(source('42',decl)),new RegExp(code+':')));
test('compound dimension cannot erase or mix unrelated units',()=>{
 assert.throws(()=>compileProgramV2(source('42<Newton>')),/E_UNIT_ERASURE/);
 assert.throws(()=>compileProgramV2(source('(42<Newton>+1<Joule>)/1<Newton>')),/E_UNIT_DIMENSION/);
});
test('strict profile remains fail closed',()=>assert.throws(()=>compileVerifiedStrict(source('42')),/E_VERIFY_UNSUPPORTED/));
