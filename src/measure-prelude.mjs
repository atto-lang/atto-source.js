// Exact compiler-owned source from common-source #164.
// SHA-256 a411966eb3188104cd13cc2201b4d1d0de1e12404378aba313b396ae726a3376.
export const MEASURE_SOURCE="// Portable core reference prelude; file-local Verified Core candidate.\n// Import/export and generic refinements are not yet admitted by this profile.\ndefine dimension Length;\ndefine unit Meter: Length;\ndefine unit Millimeter: Length = Meter / 1000;\ndefine unit Centimeter: Length = Meter / 100;\ndefine unit Kilometer: Length = Meter * 1000;\ndefine unit Micrometer: Length = Meter / 1000000;\ndefine unit Nanometer: Length = Meter / 1000000000;\n// Complete SI decimal length prefix family; scales remain exact rational.\ndefine unit Decameter: Length = Meter * 10;\ndefine unit Hectometer: Length = Decameter * 10;\ndefine unit Megameter: Length = Kilometer * 1000;\ndefine unit Gigameter: Length = Megameter * 1000;\ndefine unit Terameter: Length = Gigameter * 1000;\ndefine unit Petameter: Length = Terameter * 1000;\ndefine unit Exameter: Length = Petameter * 1000;\ndefine unit Zettameter: Length = Exameter * 1000;\ndefine unit Yottameter: Length = Zettameter * 1000;\ndefine unit Ronnameter: Length = Yottameter * 1000;\ndefine unit Quettameter: Length = Ronnameter * 1000;\ndefine unit Decimeter: Length = Meter / 10;\ndefine unit Picometer: Length = Nanometer / 1000;\ndefine unit Femtometer: Length = Picometer / 1000;\ndefine unit Attometer: Length = Femtometer / 1000;\ndefine unit Zeptometer: Length = Attometer / 1000;\ndefine unit Yoctometer: Length = Zeptometer / 1000;\ndefine unit Rontometer: Length = Yoctometer / 1000;\ndefine unit Quectometer: Length = Rontometer / 1000;\ndefine dimension Time;\ndefine unit Second: Time;\ndefine unit Millis: Time = Second / 1000;\ndefine unit Micros: Time = Second / 1000000;\ndefine unit Nanos: Time = Second / 1000000000;\ndefine unit Minute: Time = Second * 60;\ndefine unit Hour: Time = Second * 3600;\ndefine unit Day: Time = Second * 86400;\ndefine dimension Mass;\ndefine unit Kilogram: Mass;\ndefine unit Gram: Mass = Kilogram / 1000;\ndefine unit Milligram: Mass = Gram / 1000;\ndefine dimension ElectricCurrent;\ndefine unit Ampere: ElectricCurrent;\ndefine unit Milliampere: ElectricCurrent = Ampere / 1000;\ndefine dimension Temperature;\n// Linear temperature differences only; absolute points are separately gated.\ndefine unit Kelvin: Temperature;\ndefine dimension AmountOfSubstance;\ndefine unit Mole: AmountOfSubstance;\ndefine dimension LuminousIntensity;\ndefine unit Candela: LuminousIntensity;\ndefine dimension Information;\ndefine unit Bit: Information;\ndefine unit Byte: Information = Bit * 8;\ndefine unit Kilobyte: Information = Byte * 1000;\ndefine unit Megabyte: Information = Byte * 1000000;\ndefine unit Gigabyte: Information = Byte * 1000000000;\ndefine unit Kibibyte: Information = Byte * 1024;\ndefine unit Mebibyte: Information = Byte * 1048576;\ndefine unit Gibibyte: Information = Byte * 1073741824;\n\ntype PositiveInt = int where self > 0;\ntype NegativeInt = int where self < 0;\ntype NonNegativeInt = int where self >= 0;\ntype NonPositiveInt = int where self <= 0;\ntype PositiveI32 = i32 where self > 0;\ntype NegativeI32 = i32 where self < 0;\ntype NonNegativeI32 = i32 where self >= 0;\ntype NonPositiveI32 = i32 where self <= 0;\n";
const units=new Set(),aliases=new Set();
for(const line of MEASURE_SOURCE.split("\n")){
 const m=/^define unit (\w+):/.exec(line),a=/^type (\w+) =/.exec(line);
 if(m)units.add(m[1]);if(a)aliases.add(a[1]);
}
export function requestsMeasurePrelude(tokens){
 const is=(i,v)=>tokens[i]?.kind==="id"&&tokens[i].value===v;
 if(!is(0,"pub")||!is(1,"fnc")||!is(2,"main")||tokens[3]?.value!=="(")return false;
 for(let i=4;i+3<tokens.length;i++){
   const [a,b,c,d]=tokens.slice(i,i+4);
   if(a.kind==="int"&&b.value==="<"&&c.kind==="id"&&units.has(c.value)&&d.value===">"&&a.line===b.line&&a.col+a.value.length===b.col)return true;
   if(a.kind==="id"&&a.value==="val"){
     if(b.kind==="id"&&aliases.has(b.value)&&c.kind==="id"&&d.value==="=")return true;
     if(b.kind==="id"&&c.value===":"&&d.kind==="id"&&aliases.has(d.value))return true;
   }
 }
 return false;
}
