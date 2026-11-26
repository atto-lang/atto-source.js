import {WorkerMixedLayout} from "../../src/worker-mixed-layout.mjs";

let store=null;
export async function receive(mail,self){
  if(!mail || typeof mail.type!=="string")throw new TypeError("invalid mixed worker command");
  switch(mail.type){
    case "init":
      if(store && !store.retired)throw new Error("mixed actor state already initialized");
      store=new WorkerMixedLayout(mail.options);
      self.respond({rows:store.rows,layout:store.layout,bytes:store.byteLength});
      break;
    case "read":
      if(!store)throw new Error("not initialized");
      self.respond(store.read(mail.row,mail.field));break;
    case "write":
      if(!store)throw new Error("not initialized");
      store.write(mail.row,mail.field,mail.value);self.respond(true);break;
    case "integrate":
      if(!store)throw new Error("not initialized");
      store.integrate(mail.positionField,mail.velocityField,mail.dt);
      self.respond(store.snapshot(mail.positionField));break;
    case "retire":
      if(!store)throw new Error("not initialized");
      store.retire();self.respond(true);break;
    default:throw new Error("unknown mixed worker command");
  }
  self.done();
}
