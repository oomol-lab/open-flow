/* oxlint-disable no-underscore-dangle -- Guest bridge names match the VM host bindings. */
/* global __hostPrimitive, __hostTimer, __hostClearTimer, __hostBuiltin */
const builtinCall = __hostBuiltin
delete globalThis.__hostBuiltin
const loaded = new Map()
export function loadBuiltin(name) {
  if (!loaded.has(name)) loaded.set(name, builtinCall(name))
  return loaded.get(name)
}

const primitiveCall = __hostPrimitive
const timerCall = __hostTimer
const clearTimerCall = __hostClearTimer
delete globalThis.__hostPrimitive
delete globalThis.__hostTimer
delete globalThis.__hostClearTimer

export function primitive(operation, args, buffer, extra) {
  const response = primitiveCall(JSON.stringify({ operation, ...args }), buffer, extra)
  if (typeof response !== 'string') return response
  const result = JSON.parse(response)
  if (result.error) {
    const Constructor = globalThis[result.error.name]
    const error = new (typeof Constructor === 'function' ? Constructor : Error)(result.error.message)
    if (result.error.code) error.code = result.error.code
    throw error
  }
  return result.value
}

export function binary(value) {
  if (value instanceof ArrayBuffer) value = new Uint8Array(value)
  if (!ArrayBuffer.isView(value)) throw new TypeError('Expected an ArrayBuffer or ArrayBufferView.')
  if (value.byteLength > 1024 * 1024) throw new RangeError('Builtin payload too large.')
  const view = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  const buffer = view.byteLength === view.buffer.byteLength ? view.buffer : view.slice().buffer
  return { buffer, offset: 0, length: view.byteLength }
}

// Primitive calls carry at most 1 MiB, and JSON escaping can grow text sixfold, so text and bytes cross in 128 Ki pieces.
const transferUnits = 131072

function concatenate(parts) {
  if (parts.length === 1) return parts[0]
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0))
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }
  return bytes
}

class TextEncoder {
  get encoding() {
    return 'utf-8'
  }
  encode(value = '') {
    const text = String(value)
    const parts = []
    let start = 0
    do {
      let end = Math.min(start + transferUnits, text.length)
      // Keep surrogate pairs in one piece.
      if (end < text.length && (text.charCodeAt(end - 1) & 0xfc00) === 0xd800) end--
      parts.push(new Uint8Array(primitive('encode', { text: text.slice(start, end) })))
      start = end
    } while (start < text.length)
    return concatenate(parts)
  }
  encodeInto(value, destination) {
    if (!(destination instanceof Uint8Array)) throw new TypeError('Expected a Uint8Array.')
    const text = String(value)
    const encoded = this.encode(text)
    let read = 0
    let written = 0
    for (const character of text) {
      const code = character.codePointAt(0)
      const size = code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4
      if (written + size > destination.length) break
      written += size
      read += character.length
    }
    destination.set(encoded.subarray(0, written))
    return { read, written }
  }
}

class TextDecoder {
  #id
  #encoding
  #fatal
  #ignoreBOM
  constructor(label = 'utf-8', options = {}) {
    this.#fatal = Boolean(options.fatal)
    this.#ignoreBOM = Boolean(options.ignoreBOM)
    this.#encoding = primitive('decoder', { label: String(label), fatal: this.#fatal, ignoreBOM: this.#ignoreBOM }).encoding
  }
  get encoding() {
    return this.#encoding
  }
  get fatal() {
    return this.#fatal
  }
  get ignoreBOM() {
    return this.#ignoreBOM
  }
  decode(value = new Uint8Array(), options = {}) {
    const view = value instanceof ArrayBuffer ? new Uint8Array(value) : value
    if (!ArrayBuffer.isView(view)) throw new TypeError('Expected an ArrayBuffer or ArrayBufferView.')
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
    const stream = Boolean(options.stream)
    let text = ''
    let offset = 0
    do {
      const length = Math.min(transferUnits, bytes.length - offset)
      // Earlier pieces stream through one host decoder; the host releases it once a call does not stream.
      const request = {
        label: this.#encoding,
        fatal: this.#fatal,
        ignoreBOM: this.#ignoreBOM,
        offset: 0,
        length,
        stream: stream || offset + length < bytes.length,
      }
      let result
      try {
        result = primitive('decode', this.#id === undefined ? request : { ...request, id: this.#id }, bytes.slice(offset, offset + length).buffer)
      } catch (error) {
        this.#id = undefined
        throw error
      }
      this.#id = result.id
      text += result.text
      offset += length
    } while (offset < bytes.length)
    return text
  }
}

function setTimeout(callback, delay = 0, ...args) {
  if (typeof callback !== 'function') throw new TypeError('Timer callback must be a function.')
  const duration = Number(delay)
  return timerCall(() => callback(...args), Number.isFinite(duration) && duration >= 1 && duration <= 2147483647 ? Math.trunc(duration) : 1, false)
}
function setInterval(callback, delay = 0, ...args) {
  if (typeof callback !== 'function') throw new TypeError('Timer callback must be a function.')
  const duration = Number(delay)
  return timerCall(() => callback(...args), Number.isFinite(duration) && duration >= 1 && duration <= 2147483647 ? Math.trunc(duration) : 1, true)
}
function clearTimeout(id) {
  clearTimerCall(Number(id))
}
function queueMicrotask(callback) {
  if (typeof callback !== 'function') throw new TypeError('Microtask callback must be a function.')
  Promise.resolve().then(callback)
}

Object.assign(globalThis, {
  TextEncoder,
  TextDecoder,
  setTimeout,
  setInterval,
  clearTimeout,
  clearInterval: clearTimeout,
  setImmediate: (callback, ...args) => setTimeout(callback, 0, ...args),
  clearImmediate: clearTimeout,
  queueMicrotask,
  atob: (value) => primitive('atob', { text: String(value) }),
  btoa: (value) => primitive('btoa', { text: String(value) }),
  crypto: {
    randomUUID: () => primitive('uuid', {}),
    getRandomValues(value) {
      if (!ArrayBuffer.isView(value) || value instanceof DataView || value instanceof Float32Array || value instanceof Float64Array) {
        throw new TypeError('Expected an integer TypedArray.')
      }
      const random = new Uint8Array(primitive('random', { length: value.byteLength }))
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength).set(random)
      return value
    },
  },
})
globalThis.global = globalThis
globalThis.self = globalThis
