import {MixedLayoutGeometry} from "./mixed-layout-geometry.mjs";

// Worker-private heterogeneous payloads. Neither the backing ArrayBuffer nor
// a live DataView/TypedArray is ever returned to guest or host callers.
const NativeBuffer=ArrayBuffer;
const NativeDataView=DataView;
const NativeUint8Array=Uint8Array;
const getU32=DataView.prototype.getUint32;
const putU32=DataView.prototype.setUint32;
const getF64=DataView.prototype.getFloat64;
const putF64=DataView.prototype.setFloat64;
const getU8=DataView.prototype.getUint8;
const putU8=DataView.prototype.setUint8;
const fill=Uint8Array.prototype.fill;

export class WorkerMixedLayout {
  #geometry;
  #buffer;
  #view;
  #retired=false;

  constructor(options) {
    this.#geometry=new MixedLayoutGeometry(options);
    this.#buffer=new NativeBuffer(this.#geometry.byteLength);
    this.#view=new NativeDataView(this.#buffer);
  }
  get rows(){return this.#geometry.rows;}
  get fields(){return this.#geometry.fields;}
  get layout(){return this.#geometry.layout;}
  get byteLength(){return this.#geometry.byteLength;}
  get payloadBytes(){return this.#geometry.payloadBytes;}
  get retired(){return this.#retired;}

  #live(){if(this.#retired)throw new Error("mixed actor layout retired");}
  address(row,field){this.#live();return this.#geometry.address(row,field);}

  read(row,field) {
    const p=this.address(row,field),at=p.absoluteByteOffset;
    switch(p.type){
      case "u32":case "ref32":return getU32.call(this.#view,at,true);
      case "f64":return getF64.call(this.#view,at,true);
      case "bool":return getU8.call(this.#view,at)!==0;
      default:throw new Error("unsupported mixed scalar");
    }
  }

  write(row,field,value){
    const p=this.address(row,field),at=p.absoluteByteOffset;
    switch(p.type){
      case "u32":case "ref32":
        if(!Number.isInteger(value)||value<0||value>0xffffffff)
          throw new RangeError("u32/ref32 must be an unsigned 32-bit word");
        putU32.call(this.#view,at,value,true);return;
      case "f64":
        if(typeof value!=="number")throw new TypeError("f64 required");
        putF64.call(this.#view,at,value,true);return;
      case "bool":
        if(typeof value!=="boolean")throw new TypeError("bool required");
        putU8.call(this.#view,at,value?1:0);return;
      default:throw new Error("unsupported mixed scalar");
    }
  }

  // Numeric ECS-style kernel, without intermediate boxed row objects.
  integrate(positionField,velocityField,dt){
    this.#live();
    if(positionField===velocityField || !Number.isFinite(dt) ||
       this.#geometry.typeOf(positionField)!=="f64" ||
       this.#geometry.typeOf(velocityField)!=="f64")
      throw new RangeError("integrate requires distinct f64 fields and finite dt");
    for(let row=0;row<this.rows;row++){
      this.write(row,positionField,this.read(row,positionField)+
        this.read(row,velocityField)*dt);
    }
  }

  snapshot(field){
    this.#live();
    const result=[];
    for(let row=0;row<this.rows;row++)result.push(this.read(row,field));
    return result;
  }

  retire(){
    if(this.#retired)return;
    fill.call(new NativeUint8Array(this.#buffer),0);
    this.#retired=true;
    this.#view=null;
    this.#buffer=null;
  }
}
