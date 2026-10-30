/* oxlint-disable no-underscore-dangle -- Methods implement the readable-stream Transform contract. */
import { Buffer } from 'buffer'
import { binary, primitive, loadBuiltin } from 'guest:primitives'
import { Transform } from 'stream'

// Workerd does not provide RIPEMD-160; preserve the existing guest algorithm.

class NativeHash extends Transform {
  #id
  #hmac
  constructor(algorithm, key, hmac) {
    super()
    this.#hmac = hmac
    const data = binary(typeof key === 'string' ? Buffer.from(key) : key)
    this.#id = primitive('hash.create', { algorithm, hmac, offset: data.offset, length: data.length }, data.buffer)
  }
  update(input, encoding) {
    if (this.#id === undefined) throw new Error('Digest already called or hash destroyed.')
    const data = binary(typeof input === 'string' ? Buffer.from(input, encoding) : input)
    primitive('hash.update', { id: this.#id, offset: data.offset, length: data.length }, data.buffer)
    return this
  }
  digest(encoding) {
    if (this.#id === undefined && this.#hmac) return encoding ? '' : Buffer.alloc(0)
    if (this.#id === undefined) throw new Error('Digest already called or hash destroyed.')
    const id = this.#id
    this.#id = undefined
    const result = Buffer.from(primitive('hash.digest', { id }))
    return encoding ? result.toString(encoding) : result
  }
  _transform(data, encoding, callback) {
    try {
      this.update(data, encoding)
    } catch (error) {
      callback(error)
      return
    }
    callback()
  }
  _flush(callback) {
    try {
      this.push(this.digest())
    } catch (error) {
      callback(error)
      return
    }
    callback()
  }
  _destroy(error, callback) {
    if (this.#id !== undefined) {
      const id = this.#id
      this.#id = undefined
      try {
        primitive('hash.dispose', { id })
      } catch (failure) {
        callback(error ?? failure)
        return
      }
    }
    callback(error)
  }
}
export function createHash(algorithm) {
  if (typeof algorithm === 'string' && ['ripemd160', 'rmd160'].includes(algorithm.toLowerCase())) return loadBuiltin('crypto').default.createHash(algorithm)
  return new NativeHash(algorithm, new ArrayBuffer(0), false)
}
export function createHmac(algorithm, key) {
  if (typeof algorithm === 'string' && ['ripemd160', 'rmd160'].includes(algorithm.toLowerCase()))
    return loadBuiltin('crypto').default.createHmac(algorithm, key)
  return new NativeHash(algorithm, key, true)
}
