export function deferScheduleCheck<T>(check: () => T, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      globalThis.clearTimeout(timeout)
      reject(signal.reason)
    }
    const timeout = globalThis.setTimeout(() => {
      signal.removeEventListener('abort', abort)
      if (signal.aborted) return reject(signal.reason)
      try {
        resolve(check())
      } catch (error) {
        reject(error)
      }
    }, 0)
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
}
