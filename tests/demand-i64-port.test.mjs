import test from 'node:test';
import assert from 'node:assert/strict';
import {DemandI64Port} from '../src/demand-i64-port.mjs';

test('demand credits, exclusive reader, FIFO and checked-out byte accounting', () => {
  const port = new DemandI64Port({capacity:2,maxInFlight:1,maxBytes:24,maxDemand:4});
  assert.equal(port.tryOffer(1n),'no-subscriber');
  const lease=port.subscribe();
  assert.throws(()=>port.subscribe(),/exclusive/);
  assert.equal(port.tryOffer(1n),'no-demand');
  assert.throws(()=>port.request({},1),/foreign/);
  assert.throws(()=>port.request(lease,0),/positive/);
  port.request(lease,4);
  assert.equal(port.tryOffer(1n),'accepted');
  assert.equal(port.tryOffer(2n),'accepted');
  assert.equal(port.tryOffer(3n),'full');
  const a=port.tryNext(lease);
  assert.equal(a.value,1n);
  assert.equal(port.tryNext(lease).kind,'not-ready');
  assert.equal(port.tryOffer(3n),'accepted');
  assert.equal(port.retainedBytes,24);
  assert.equal(port.ack(lease,a.ticket),true);
  assert.equal(port.ack(lease,a.ticket),false);
  const b=port.tryNext(lease),c=(port.ack(lease,b.ticket),port.tryNext(lease));
  assert.equal(b.value,2n);
  assert.equal(c.value,3n);
  assert.equal(port.ack(lease,c.ticket),true);
  assert.equal(port.retainedBytes,0);
  assert.equal(port.outstandingDemand,1);
});

test('graceful close is irreversible and drains committed FIFO', () => {
  const port = new DemandI64Port({capacity:2,maxInFlight:2,maxBytes:16,maxDemand:2});
  const lease=port.subscribe();
  port.request(lease,2);
  port.tryOffer(9n);port.tryOffer(10n);
  assert.equal(port.complete(),true);
  assert.equal(port.cancel(),false);
  assert.equal(port.tryOffer(11n),'closed');
  const a=port.tryNext(lease),b=port.tryNext(lease);
  assert.deepEqual([a.value,b.value],[9n,10n]);
  assert.equal(port.ack(lease,a.ticket),true);
  assert.equal(port.ack(lease,b.ticket),true);
  assert.equal(port.tryNext(lease).kind,'complete');
  assert.equal(port.retainedBytes,0);
});

test('cancel drops queued bytes and preserves outstanding physical loans until ACK', () => {
  const port = new DemandI64Port({capacity:2,maxInFlight:1,maxBytes:16,maxDemand:2});
  const lease=port.subscribe();
  port.request(lease,2);
  port.tryOffer(1n);port.tryOffer(2n);
  const a=port.tryNext(lease);
  assert.equal(port.cancel(),true);
  assert.equal(port.complete(),false);
  assert.equal(port.queued,0);
  assert.equal(port.inFlight,1);
  assert.equal(port.retainedBytes,8);
  assert.equal(port.tryNext(lease).kind,'cancelled');
  assert.equal(port.ack(lease,a.ticket),true);
  assert.equal(port.retainedBytes,0);
});

test('byte quota and malformed input refuse before modifying credit', () => {
  const port = new DemandI64Port({capacity:2,maxInFlight:2,maxBytes:8,maxDemand:2});
  const lease=port.subscribe();
  port.request(lease,2);
  assert.throws(()=>port.tryOffer(Number.MAX_SAFE_INTEGER),/signed i64 BigInt/);
  assert.throws(()=>port.tryOffer(1n<<63n),/signed i64 BigInt/);
  assert.equal(port.outstandingDemand,2);
  assert.equal(port.tryOffer(7n),'accepted');
  assert.equal(port.tryOffer(8n),'byte-budget');
  assert.equal(port.outstandingDemand,1);
  const a=port.tryNext(lease);
  assert.equal(port.tryOffer(8n),'byte-budget');
  assert.equal(port.ack(lease,a.ticket),true);
  assert.equal(port.tryOffer(8n),'accepted');
  assert.equal(port.ack(lease,port.tryNext(lease).ticket),true);
});

test('bounded constructor limits reject dangerous descriptor sizes', () => {
  assert.throws(()=>new DemandI64Port({capacity:65537}),RangeError);
  assert.throws(()=>new DemandI64Port({capacity:1,maxInFlight:4097}),RangeError);
  assert.throws(()=>new DemandI64Port({capacity:1,maxDemand:0}),RangeError);
});
