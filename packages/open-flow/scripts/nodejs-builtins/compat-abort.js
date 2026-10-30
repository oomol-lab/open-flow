const signals = new WeakMap()
const controllers = new WeakMap()

function stateOf(map, receiver) {
  const state = map.get(receiver)
  if (!state) throw new TypeError('Illegal invocation')
  return state
}

function createSignal() {
  const signal = Object.create(AbortSignal.prototype)
  signals.set(signal, { reason: undefined, listeners: [], handler: null, sources: undefined, dependents: new Set() })
  return signal
}

function removeListener(state, listener) {
  listener.removed = true
  state.listeners.splice(state.listeners.indexOf(listener), 1)
}

function dispatch(signal, input) {
  const state = stateOf(signals, signal)
  const type = input?.type
  if (input === null || typeof input !== 'object' || typeof type !== 'string') throw new TypeError('Expected an event with a string type')
  const cancelable = Boolean(input.cancelable)
  let active = true
  let stopped = false
  let passive = false
  let prevented = Boolean(input.defaultPrevented)
  const event = {
    type,
    get target() {
      return signal
    },
    get currentTarget() {
      return active ? signal : null
    },
    get eventPhase() {
      return active ? 2 : 0
    },
    get defaultPrevented() {
      return prevented
    },
    bubbles: Boolean(input.bubbles),
    cancelable,
    isTrusted: false,
    timeStamp: input.timeStamp ?? Date.now(),
    preventDefault() {
      if (cancelable && !passive) prevented = true
    },
    stopPropagation() {},
    stopImmediatePropagation() {
      stopped = true
    },
    composedPath() {
      return active ? [signal] : []
    },
  }
  Object.setPrototypeOf(event, input)
  try {
    for (const listener of state.listeners.slice()) {
      if (listener.removed || listener.type !== type) continue
      if (listener.once) removeListener(state, listener)
      passive = listener.passive
      try {
        if (typeof listener.callback === 'function') listener.callback.call(signal, event)
        else if (typeof listener.callback.handleEvent === 'function') listener.callback.handleEvent(event)
      } catch (error) {
        console.error(error)
      }
      if (stopped) break
    }
  } finally {
    active = false
    passive = false
  }
  return !prevented
}

function abort(signal, reason) {
  const state = signals.get(signal)
  if (state.reason !== undefined) return
  if (reason === undefined) reason = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })
  const aborted = [signal, ...state.dependents]
  for (const current of aborted) {
    const next = signals.get(current)
    next.reason = reason
    next.dependents.clear()
    if (next.sources) {
      for (const source of next.sources) signals.get(source).dependents.delete(current)
      next.sources.clear()
    }
  }
  for (const current of aborted) dispatch(current, { type: 'abort' })
}

export class AbortSignal {
  constructor() {
    throw new TypeError('AbortSignal cannot be constructed directly')
  }

  get aborted() {
    return stateOf(signals, this).reason !== undefined
  }

  get reason() {
    return stateOf(signals, this).reason
  }

  throwIfAborted() {
    const reason = stateOf(signals, this).reason
    if (reason !== undefined) throw reason
  }

  get onabort() {
    return stateOf(signals, this).handler?.callback ?? null
  }

  set onabort(callback) {
    const state = stateOf(signals, this)
    if (typeof callback !== 'function') callback = null
    if (state.handler) {
      if (callback) state.handler.callback = callback
      else {
        removeListener(state, state.handler)
        state.handler = null
      }
    } else if (callback) {
      state.handler = { type: 'abort', callback, capture: false, once: false, passive: false, removed: false, attribute: true }
      state.listeners.push(state.handler)
    }
  }

  addEventListener(type, callback, options) {
    const state = stateOf(signals, this)
    type = `${type}`
    if (callback == null) return
    if (typeof callback !== 'function' && typeof callback !== 'object') throw new TypeError('Expected a function or listener object')
    const capture = typeof options === 'boolean' ? options : Boolean(options?.capture)
    if (state.listeners.some((listener) => listener.type === type && listener.callback === callback && listener.capture === capture && !listener.attribute))
      return
    state.listeners.push({ type, callback, capture, once: Boolean(options?.once), passive: Boolean(options?.passive), removed: false, attribute: false })
  }

  removeEventListener(type, callback, options) {
    const state = stateOf(signals, this)
    type = `${type}`
    const capture = typeof options === 'boolean' ? options : Boolean(options?.capture)
    const listener = state.listeners.find(
      (candidate) => candidate.type === type && candidate.callback === callback && candidate.capture === capture && !candidate.attribute,
    )
    if (listener) removeListener(state, listener)
  }

  dispatchEvent(event) {
    return dispatch(this, event)
  }

  static abort(reason) {
    const signal = createSignal()
    abort(signal, reason)
    return signal
  }

  static timeout(milliseconds) {
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds > 2147483647) throw new RangeError('Invalid timeout.')
    const signal = createSignal()
    setTimeout(() => abort(signal, Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' })), milliseconds)
    return signal
  }

  static any(signalsToCombine) {
    const sources = Array.from(signalsToCombine)
    const states = sources.map((signal) => stateOf(signals, signal))
    const signal = createSignal()
    const state = signals.get(signal)
    const aborted = states.find((source) => source.reason !== undefined)
    if (aborted) {
      state.reason = aborted.reason
      return signal
    }
    state.sources = new Set()
    for (const [index, source] of states.entries()) {
      for (const root of source.sources ?? [sources[index]]) {
        state.sources.add(root)
        signals.get(root).dependents.add(signal)
      }
    }
    return signal
  }
}

export class AbortController {
  constructor() {
    controllers.set(this, createSignal())
  }

  get signal() {
    return stateOf(controllers, this)
  }

  abort(reason) {
    abort(stateOf(controllers, this), reason)
  }
}

for (const [name, Constructor] of Object.entries({ AbortController, AbortSignal })) {
  Object.defineProperty(Constructor.prototype, Symbol.toStringTag, { value: name, configurable: true })
}

export default AbortController
