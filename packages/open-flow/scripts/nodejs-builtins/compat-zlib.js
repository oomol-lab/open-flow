import { Buffer } from 'buffer'
import { binary, primitive } from 'guest:primitives'
import value from 'zlib'

for (const name of ['gzip', 'gunzip', 'deflate', 'inflate', 'deflateRaw', 'inflateRaw', 'unzip']) {
  const method = name + 'Sync'
  const compress = (input, options = {}) => {
    const data = binary(typeof input === 'string' ? Buffer.from(input) : input)
    options ??= {}
    const dictionary = binary(options.dictionary ?? new ArrayBuffer(0))
    const settings = {}
    for (const key of ['level', 'windowBits', 'memLevel', 'strategy', 'chunkSize', 'flush', 'finishFlush', 'maxOutputLength']) {
      if (options[key] !== undefined) settings[key] = options[key]
    }
    return Buffer.from(
      primitive(
        'zlib',
        {
          method,
          offset: data.offset,
          length: data.length,
          options: settings,
          dictionary: options.dictionary === undefined ? undefined : { offset: dictionary.offset, length: dictionary.length },
        },
        data.buffer,
        dictionary.buffer,
      ),
    )
  }
  value[method] = compress
  value[name] = (input, options, callback) => {
    if (typeof options === 'function') {
      callback = options
      options = undefined
    }
    if (typeof callback !== 'function') throw new TypeError('Expected a callback.')
    queueMicrotask(() => {
      let result
      try {
        result = compress(input, options)
      } catch (error) {
        callback(error)
        return
      }
      callback(null, result)
    })
  }
}
export default value
