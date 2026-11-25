// Backend-owned JS host implementation for Atto std/time timer admission.
// This is NOT an Atto guest compiler intrinsic or a security capability.
// Positive i64 nanosecond values are represented as BigInt, never Number.
export const MAX_TIME_NS=(1n<<63n)-1n;
const NS_PER_MS=1000000n;
const HOST_TIMEOUT_LIMIT_MS=2147483647n;
export class StdTimeError extends Error {
  constructor(code) { super(code); this.name='StdTimeError'; this.code=code; }
}
function fail(code) { throw new StdTimeError(code); }
function duration(value) {
  if(typeof value!=='bigint')fail('DurationType');
  if(value<0n)fail('NegativeDuration');
  if(value>MAX_TIME_NS)fail('DurationOverflow');
  return value;
}
export function nanoseconds(value) { return duration(value); }
export function microseconds(value) { return scaled(value,1000n); }
export function milliseconds(value) { return scaled(value,1000000n); }
export function seconds(value) { return scaled(value,1000000000n); }
export function minutes(value) { return scaled(value,60000000000n); }
export function hours(value) { return scaled(value,3600000000000n); }
function scaled(value,scale) {
  duration(value);
  if(value>MAX_TIME_NS/scale)fail('DurationOverflow');
  return value*scale;
}
export function checked_add(a,b) {
  duration(a);duration(b);
  if(b>MAX_TIME_NS-a)fail('DurationOverflow');
  return a+b;
}
export function checked_sub(a,b) {
  duration(a);duration(b);
  if(b>a)fail('DurationUnderflow');
  return a-b;
}
export function checked_mul(a,factor) {
  duration(a);duration(factor);
  if(factor!==0n && a>MAX_TIME_NS/factor)fail('DurationOverflow');
  return a*factor;
}
function systemNowNs() {
  const ms=performance.now();
  if(!Number.isFinite(ms)||ms<0||!Number.isSafeInteger(Math.floor(ms*1e6)))
    fail('InvalidMonotonicClock');
  return BigInt(Math.floor(ms*1e6));
}
/**
 * Per-scheduler timer adapter. The host owns the clock, registration and
 * cancellation capability. Never expose the injected callbacks to guest code.
 * Zero delay still yields to the host event loop. This does not park a carrier.
 */
export class StdTimeRuntime {
  #now;#schedule;#cancel;#limit;#pending=0;
  constructor({now_ns=systemNowNs,schedule=setTimeout,cancel=clearTimeout,limit=64}={}) {
    if(typeof now_ns!=='function'||typeof schedule!=='function'||typeof cancel!=='function'||
       !Number.isInteger(limit)||limit<1||limit>4096) fail('InvalidTimerHost');
    this.#now=now_ns;this.#schedule=schedule;this.#cancel=cancel;this.#limit=limit;
  }
  get pending() { return this.#pending; }
  monotonic_now() {
    const now=this.#now();
    if(typeof now!=='bigint'||now<0n||now>MAX_TIME_NS)
      fail('InvalidMonotonicClock');
    return now;
  }
  sleep_ns(delay,{signal}={}) {
    duration(delay);
    if(signal!==undefined &&
       (typeof AbortSignal!=='function'||!(signal instanceof AbortSignal)))
      fail('InvalidAbortSignal');
    const start=this.monotonic_now();
    if(delay>MAX_TIME_NS-start)fail('DeadlineOverflow');
    if(this.#pending>=this.#limit)fail('TimerCapacityExceeded');
    const deadline=start+delay;
    this.#pending++;
    let last=start,timer=null,settled=false;
    return new Promise((resolve,reject)=>{
      const finish=error=>{
        if(settled)return;
        settled=true;
        if(timer!==null) {const current=timer;timer=null;this.#cancel(current);}
        signal?.removeEventListener('abort',onAbort);
        this.#pending--;
        if(error)reject(error);else resolve();
      };
      const onAbort=()=>finish(new StdTimeError('TimerCancelled'));
      const arm=ms=>{
        let returned=false;
        try {
          const handle=this.#schedule(()=>{
            if(!returned) {
              finish(new StdTimeError('SynchronousTimerCallback'));
              return;
            }
            timer=null;
            if(settled)return;
            let now;
            try { now=this.monotonic_now(); }
            catch(e){finish(e);return;}
            if(now<last){finish(new StdTimeError('ClockWentBackwards'));return;}
            last=now;
            if(now>=deadline){finish();return;}
            arm(nextWait(now));
          },ms);
          returned=true;
          timer=handle;
          if(settled){timer=null;this.#cancel(handle);}
        } catch(e){finish(e);}
      };
      const nextWait=now=>{
        const remaining=deadline-now;
        if(remaining<=0n)return 0;
        const ms=(remaining+NS_PER_MS-1n)/NS_PER_MS;
        return Number(ms>HOST_TIMEOUT_LIMIT_MS?HOST_TIMEOUT_LIMIT_MS:ms);
      };
      try {
        if(signal?.aborted){onAbort();return;}
        signal?.addEventListener('abort',onAbort,{once:true});
        if(signal?.aborted){onAbort();return;}
        // A zero-duration suspension must still have an event-loop boundary.
        arm(delay===0n?0:nextWait(start));
      } catch(e){finish(e);}
    });
  }
}
