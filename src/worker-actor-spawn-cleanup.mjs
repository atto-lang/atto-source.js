// Worker creation can succeed before client configuration fails. The caller
// must preserve that original configuration error while observing asynchronous
// Node termination rejections and swallowing browser termination throws.
// This is only for failed construction; normal client close reports failures.
export function terminateFailedWorkerSpawn(worker) {
  try {
    void Promise.resolve(worker.terminate()).catch(() => {});
  } catch {
    // The original client-construction failure is the actionable exception.
  }
}
