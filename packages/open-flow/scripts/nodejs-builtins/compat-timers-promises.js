// Promise timers that leave no unobserved rejected Promise behind; strict Hosts report those as Task failures.
class AbortError extends Error {
  constructor(cause) {
    super('The operation was aborted', cause === undefined ? undefined : { cause })
    this.name = 'AbortError'
    this.code = 'ABORT_ERR'
  }
}

function invalid(name, expected, value) {
  const error = new TypeError(`The "${name}" argument must be ${expected}. Received ${typeof value}`)
  error.code = 'ERR_INVALID_ARG_TYPE'
  return error
}

function validate(options) {
  if (options === null || typeof options !== 'object') throw invalid('options', 'of type object', options)
  const { signal, ref = true } = options
  if (signal !== undefined && (signal === null || typeof signal !== 'object' || !('aborted' in signal))) {
    throw invalid('options.signal', 'an instance of AbortSignal', signal)
  }
  if (typeof ref !== 'boolean') throw invalid('options.ref', 'of type boolean', ref)
  return signal
}

function schedule(start, cancel, value, options) {
  let signal
  try {
    signal = validate(options)
  } catch (error) {
    return Promise.reject(error)
  }
  if (signal?.aborted) return Promise.reject(new AbortError(signal.reason))
  return new Promise((resolve, reject) => {
    const abort = () => {
      cancel(id)
      reject(new AbortError(signal.reason))
    }
    const id = start(() => {
      signal?.removeEventListener('abort', abort)
      resolve(value)
    })
    signal?.addEventListener('abort', abort, { once: true })
  })
}

export function setTimeout(delay = 1, value = undefined, options = {}) {
  return schedule(
    (callback) => globalThis.setTimeout(callback, delay),
    (id) => globalThis.clearTimeout(id),
    value,
    options,
  )
}

export function setImmediate(value = undefined, options = {}) {
  return schedule(
    (callback) => globalThis.setImmediate(callback),
    (id) => globalThis.clearImmediate(id),
    value,
    options,
  )
}

export async function* setInterval(delay = 1, value = undefined, options = {}) {
  const signal = validate(options)
  if (signal?.aborted) throw new AbortError(signal.reason)
  let ticks = 0
  let wake
  const id = globalThis.setInterval(() => {
    ticks++
    wake?.()
  }, delay)
  const abort = () => wake?.()
  signal?.addEventListener('abort', abort, { once: true })
  try {
    while (true) {
      if (ticks === 0 && !signal?.aborted) await new Promise((resolve) => (wake = resolve))
      wake = undefined
      if (signal?.aborted) throw new AbortError(signal.reason)
      for (; ticks > 0; ticks--) yield value
    }
  } finally {
    globalThis.clearInterval(id)
    signal?.removeEventListener('abort', abort)
  }
}

export const scheduler = Object.freeze({
  wait: (delay, options = {}) => setTimeout(delay, undefined, options),
  yield: () => setImmediate(),
})

export default { scheduler, setImmediate, setInterval, setTimeout }
