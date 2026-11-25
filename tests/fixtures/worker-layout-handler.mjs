import {WorkerLayoutF64} from "../../src/worker-layout-f64.mjs";

let store = null;

export async function receive(mail, self) {
  if (!mail || typeof mail.type !== "string") throw new Error("invalid layout command");
  switch (mail.type) {
    case "init":
      if (store && !store.retired) throw new Error("layout already initialized");
      store = new WorkerLayoutF64(mail.options);
      self.respond({
        rows:store.rows, fields:store.fields, layout:store.layout,
        lanes:store.lanes, physicalRows:store.physicalRows,
        byteLength:store.byteLength, groupCount:store.groupCount
      });
      break;
    case "write":
      if (!store) throw new Error("layout not initialized");
      store.write(mail.row,mail.field,mail.value);
      self.respond(true);
      break;
    case "read":
      if (!store) throw new Error("layout not initialized");
      self.respond(store.read(mail.row,mail.field));
      break;
    case "integrate":
      if (!store) throw new Error("layout not initialized");
      store.integrate(mail.positionField,mail.velocityField,mail.dt);
      self.respond(store.snapshotColumn(mail.positionField));
      break;
    case "geometry":
      if (!store) throw new Error("layout not initialized");
      self.respond(store.getPhysicalByteOffset(mail.row,mail.field));
      break;
    case "snapshot":
      if (!store) throw new Error("layout not initialized");
      self.respond(store.snapshotColumn(mail.field));
      break;
    case "retire":
      if (!store) throw new Error("layout not initialized");
      store.retire();
      self.respond(true);
      break;
    default:
      throw new Error("unknown layout command");
  }
  self.done();
}
