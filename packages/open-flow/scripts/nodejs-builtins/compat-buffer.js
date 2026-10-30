import value from 'guest:buffer'
import { binary, primitive } from 'guest:primitives'

const { Buffer, SlowBuffer, INSPECT_MAX_BYTES, kMaxLength } = value
const from = Buffer.from
const toString = Buffer.prototype.toString
const byteLength = Buffer.byteLength

Buffer.from = function (input, encoding, length) {
  if (typeof input !== 'string') return from(input, encoding, length)
  if (typeof encoding !== 'string' || encoding === '') encoding = 'utf8'
  if (!Buffer.isEncoding(encoding)) throw new TypeError('Unknown encoding: ' + encoding)
  return from(primitive('buffer.from', { text: input, encoding: encoding.toLowerCase() }))
}
Buffer.prototype.toString = function (encoding, start, end) {
  if (start === undefined || start < 0) start = 0
  if (start > this.length) return ''
  if (end === undefined || end > this.length) end = this.length
  if (end <= 0) return ''
  start >>>= 0
  end >>>= 0
  if (end <= start) return ''
  encoding = encoding ? (encoding + '').toLowerCase() : 'utf8'
  if (!Buffer.isEncoding(encoding)) return toString.call(this, encoding, start, end)
  const data = binary(this.subarray(start, end))
  return primitive('buffer.toString', { encoding, offset: data.offset, length: data.length }, data.buffer)
}
Buffer.byteLength = function (input, encoding, mustMatch) {
  if (typeof input !== 'string') return byteLength(input, encoding, mustMatch)
  encoding = (encoding + '').toLowerCase()
  if (!Buffer.isEncoding(encoding)) {
    if (mustMatch === true) return -1
    encoding = 'utf8'
  }
  if (encoding !== 'utf8' && encoding !== 'utf-8' && encoding !== 'base64') return byteLength(input, encoding, mustMatch)
  return primitive('buffer.byteLength', { text: input, encoding })
}
export { Buffer, SlowBuffer, INSPECT_MAX_BYTES, kMaxLength }
export default value
