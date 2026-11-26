import {CountedSelectI64Cursor} from './counted-select-i64-cursor.mjs';

// Host-only aggregate Promise. The trusted owner explicitly drives the
// cursor; producer notifications never execute guest arms.
export class CountedSelectI64Batch {
  #cursor; #completion; #resolve; #reject; #busy=false; #terminal=false;
  constructor(count,sources,policy='fair',projectors=null){
    this.#cursor=new CountedSelectI64Cursor(count,sources,policy,projectors);
    this.#completion=new Promise((resolve,reject)=>{this.#resolve=resolve;this.#reject=reject;});
    this.#publish();
  }
  get completion(){return this.#completion;}
  #enter(){if(this.#busy)throw new Error('counted batch driver reentry');this.#busy=true;}
  #publish(){
    if(this.#terminal)return;
    switch(this.#cursor.state){
      case 'success':
        this.#terminal=true;this.#resolve(Object.freeze(this.#cursor.result()));break;
      case 'cancelled': {
        const error=new Error('counted batch cancelled');error.name='AbortError';
        this.#terminal=true;this.#reject(error);break;
      }
      case 'failed':
        this.#terminal=true;this.#reject(this.#cursor.failure);break;
    }
    if(this.#terminal){this.#resolve=null;this.#reject=null;}
  }
  pump(){
    this.#enter();
    try{
      if(this.#terminal)return false;
      let progress=true;
      try{
        if(this.#cursor.state==='ready')this.#cursor.beginRound();
        else if(this.#cursor.state==='waiting')progress=this.#cursor.pump();
      }catch(error){if(this.#cursor.state!=='failed')throw error;}
      this.#publish();return progress;
    }finally{this.#busy=false;}
  }
  cancel(){
    this.#enter();
    try{
      if(this.#terminal)return false;
      let accepted;
      try{accepted=this.#cursor.cancel();}
      catch(error){if(this.#cursor.state!=='failed')throw error;accepted=true;}
      this.#publish();return accepted;
    }finally{this.#busy=false;}
  }
}
