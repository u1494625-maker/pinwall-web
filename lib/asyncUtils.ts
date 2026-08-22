/**
 * Races `promise` against a timer so a network call that stalls with no
 * response at all — no error, no resolution, e.g. a connection dropped
 * mid-request — can't leave a caller waiting forever with no way to surface
 * an error. A plain `.catch()` does nothing for a promise that never
 * rejects; this is the only way to guarantee the caller always moves on.
 */
export function withTimeout<T>(promise: PromiseLike<T>, ms: number, message = "Timed out."): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
