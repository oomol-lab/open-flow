import type { EngineContract } from './engineContract.ts'

import guestModules from './nodejsGuest.generated.json' with { type: 'json' }

/**
 * Guest modules of the Node compatibility engine, keyed by engine module path.
 *
 * A Host evaluates `engine/web.mjs` after installing the guest bridge, then `engine/globals.mjs`, then the Task.
 * The bridge consists of `__hostPrimitive(request, buffer?, extra?)`, which forwards to {@link NodejsPrimitives.call};
 * `__hostTimer(callback, delay, repeat)` and `__hostClearTimer(id)`, which schedule guest callbacks; and
 * `__hostBuiltin(group)`, which synchronously evaluates {@link nodejsBuiltinGroupModule} and returns its namespace.
 */
export const nodejsGuestModules: Readonly<Record<string, string>> = guestModules
export const nodejsWebModule = 'engine/web.mjs'
export const nodejsGlobalsModule = 'engine/globals.mjs'

const builtinGroups: ReadonlySet<string> = new Set(['abort', 'buffer', 'crypto', 'process', 'streams', 'url'])

/** Returns the engine module of a lazily loaded builtin group requested through `__hostBuiltin`. */
export function nodejsBuiltinGroupModule(group: string): string {
  if (!builtinGroups.has(group)) throw new TypeError('Unknown builtin group.')
  return group == 'crypto' ? 'engine/deferred/crypto.mjs' : `engine/globals/${group}.mjs`
}

/** Resolves a builtin specifier or an import between engine modules; other specifiers belong to the Host closure. */
export function resolveNodejsModule(contract: EngineContract, specifier: string, referrer: string): string | undefined {
  if (contract.builtinModules?.has(specifier)) return `engine/builtin/${specifier.replace(/^node:/, '')}.mjs`
  if (!referrer.startsWith('engine/')) return undefined
  const resolved = new URL(specifier, `https://modules.invalid/${referrer}`).pathname.slice(1)
  return Object.hasOwn(nodejsGuestModules, resolved) ? resolved : undefined
}

type Encoding = 'utf8' | 'utf-8' | 'hex' | 'base64' | 'ascii' | 'latin1' | 'binary' | 'ucs2' | 'ucs-2' | 'utf16le' | 'utf-16le'
type ZlibMethod = 'gzipSync' | 'gunzipSync' | 'deflateSync' | 'inflateSync' | 'deflateRawSync' | 'inflateRawSync' | 'unzipSync'

interface PlatformHash {
  update(data: Uint8Array): unknown
  digest(): Uint8Array
  destroy(): unknown
}

/** Platform implementations behind the primitives; Node.js and Workers with `nodejs_compat` supply their own modules. */
export interface NodejsPrimitivePlatform {
  readonly Buffer: {
    from(text: string, encoding: Encoding): Uint8Array
    from(buffer: ArrayBuffer, offset: number, length: number): { toString(encoding: Encoding): string }
    byteLength(text: string, encoding: Encoding): number
  }
  createHash(algorithm: string): PlatformHash
  createHmac(algorithm: string, key: Uint8Array): PlatformHash
  readonly zlib: Readonly<Record<ZlibMethod, (input: Uint8Array, options: object) => Uint8Array>>
}

export interface NodejsPrimitives {
  /** Serves one `__hostPrimitive` request; failures are returned as a serialized guest error. */
  call(request: string, buffer?: ArrayBuffer, extra?: ArrayBuffer): string | ArrayBuffer
  close(): void
}

const binaryLimit = 1024 * 1024
const hmacKeyLimit = 65536
const encodings: ReadonlySet<string> = new Set(['utf8', 'utf-8', 'hex', 'base64', 'ascii', 'latin1', 'binary', 'ucs2', 'ucs-2', 'utf16le', 'utf-16le'])
const urlChangeKeys: ReadonlySet<string> = new Set(['href', 'protocol', 'username', 'password', 'host', 'hostname', 'port', 'pathname', 'search', 'hash'])
const zlibMethods: ReadonlySet<string> = new Set(['gzipSync', 'gunzipSync', 'deflateSync', 'inflateSync', 'deflateRawSync', 'inflateRawSync', 'unzipSync'])
const optionalZlibNumberKeys = ['level', 'windowBits', 'memLevel', 'strategy', 'flush', 'finishFlush'] as const

type UrlChangeKey = 'href' | 'protocol' | 'username' | 'password' | 'host' | 'hostname' | 'port' | 'pathname' | 'search' | 'hash'

interface Range {
  readonly offset: number
  readonly length: number
}

interface ZlibOptions {
  readonly level?: number
  readonly windowBits?: number
  readonly memLevel?: number
  readonly strategy?: number
  readonly chunkSize?: number
  readonly flush?: number
  readonly finishFlush?: number
  readonly maxOutputLength?: number
}

type PrimitiveRequest =
  | {
      readonly operation: 'url'
      readonly input: string
      readonly base?: string
      readonly change?: { readonly key: UrlChangeKey; readonly value: string }
      readonly entries?: [string, string][]
    }
  | { readonly operation: 'params.parse'; readonly input: string }
  | { readonly operation: 'params.stringify'; readonly entries: [string, string][] }
  | { readonly operation: 'encode'; readonly text: string }
  | { readonly operation: 'decoder'; readonly label: string; readonly fatal: boolean; readonly ignoreBOM: boolean }
  | {
      readonly operation: 'decode'
      readonly id?: number
      readonly label: string
      readonly fatal: boolean
      readonly ignoreBOM: boolean
      readonly offset: number
      readonly length: number
      readonly stream: boolean
    }
  | { readonly operation: 'atob' | 'btoa'; readonly text: string }
  | { readonly operation: 'random'; readonly length: number }
  | { readonly operation: 'uuid' }
  | { readonly operation: 'buffer.from' | 'buffer.byteLength'; readonly text: string; readonly encoding: Encoding }
  | { readonly operation: 'buffer.toString'; readonly encoding: Encoding; readonly offset: number; readonly length: number }
  | {
      readonly operation: 'hash.create'
      readonly algorithm: string
      readonly hmac: boolean
      readonly text?: string
      readonly offset?: number
      readonly length?: number
    }
  | {
      readonly operation: 'hash.update'
      readonly id: number
      readonly text?: string
      readonly encoding?: Encoding
      readonly offset?: number
      readonly length?: number
    }
  | { readonly operation: 'hash.digest'; readonly id: number; readonly encoding?: Encoding }
  | { readonly operation: 'hash.dispose'; readonly id: number }
  | {
      readonly operation: 'zlib'
      readonly method: ZlibMethod
      readonly text?: string
      readonly offset?: number
      readonly length?: number
      readonly dictionary?: Range
      readonly options: ZlibOptions
    }

function invalidRequest(message: string): never {
  throw new TypeError(message)
}

function asObject(value: unknown): Record<string, unknown> {
  if (value == null || typeof value != 'object' || Array.isArray(value)) invalidRequest('Expected primitive request object.')
  return value as Record<string, unknown>
}

function asString(value: unknown): string {
  if (typeof value != 'string') invalidRequest('Expected string field.')
  return value
}

function asBoolean(value: unknown): boolean {
  if (typeof value != 'boolean') invalidRequest('Expected boolean field.')
  return value
}

function asInt(value: unknown, min: number, max: number): number {
  if (typeof value != 'number' || !Number.isInteger(value) || value < min || value > max) invalidRequest('Numeric field out of range.')
  return value
}

function asEncoding(value: unknown): Encoding {
  if (typeof value != 'string' || !encodings.has(value)) invalidRequest('Unsupported encoding.')
  return value as Encoding
}

function asRange(value: Record<string, unknown>, maxLength = binaryLimit): Range {
  return {
    offset: asInt(value.offset, 0, Number.MAX_SAFE_INTEGER),
    length: asInt(value.length, 0, maxLength),
  }
}

function asEntries(value: unknown): [string, string][] {
  if (!Array.isArray(value)) invalidRequest('Expected entries array.')
  for (const pair of value) {
    if (!Array.isArray(pair) || pair.length != 2 || typeof pair[0] != 'string' || typeof pair[1] != 'string') {
      invalidRequest('Expected string pair.')
    }
  }
  return value as [string, string][]
}

function asZlibOptions(value: unknown): ZlibOptions {
  const raw = asObject(value)
  const options: Record<string, number> = {}
  for (const key of optionalZlibNumberKeys) {
    const field = raw[key]
    if (field !== undefined) {
      if (typeof field != 'number') invalidRequest('Expected numeric zlib option.')
      options[key] = field
    }
  }
  if (raw.chunkSize !== undefined) options.chunkSize = asInt(raw.chunkSize, 64, binaryLimit)
  if (raw.maxOutputLength !== undefined) options.maxOutputLength = asInt(raw.maxOutputLength, 1, binaryLimit)
  return options as ZlibOptions
}

function parseOperation(source: unknown): PrimitiveRequest {
  const raw = asObject(source)
  const kind = asString(raw.operation)
  switch (kind) {
    case 'url': {
      const changeRaw = raw.change === undefined ? undefined : asObject(raw.change)
      let change: { readonly key: UrlChangeKey; readonly value: string } | undefined
      if (changeRaw !== undefined) {
        const key = asString(changeRaw.key)
        if (!urlChangeKeys.has(key)) invalidRequest('Unsupported URL field.')
        change = { key: key as UrlChangeKey, value: asString(changeRaw.value) }
      }
      return {
        operation: 'url',
        input: asString(raw.input),
        base: raw.base === undefined ? undefined : asString(raw.base),
        change,
        entries: raw.entries === undefined ? undefined : asEntries(raw.entries),
      }
    }
    case 'params.parse':
      return { operation: 'params.parse', input: asString(raw.input) }
    case 'params.stringify':
      return { operation: 'params.stringify', entries: asEntries(raw.entries) }
    case 'encode':
      return { operation: 'encode', text: asString(raw.text) }
    case 'decoder':
      return { operation: 'decoder', label: asString(raw.label), fatal: asBoolean(raw.fatal), ignoreBOM: asBoolean(raw.ignoreBOM) }
    case 'decode':
      return {
        operation: 'decode',
        id: raw.id === undefined ? undefined : asInt(raw.id, 1, Number.MAX_SAFE_INTEGER),
        label: asString(raw.label),
        fatal: asBoolean(raw.fatal),
        ignoreBOM: asBoolean(raw.ignoreBOM),
        ...asRange(raw),
        stream: asBoolean(raw.stream),
      }
    case 'atob':
    case 'btoa':
      return { operation: kind, text: asString(raw.text) }
    case 'random':
      return { operation: 'random', length: asInt(raw.length, 0, hmacKeyLimit) }
    case 'uuid':
      return { operation: 'uuid' }
    case 'buffer.from':
    case 'buffer.byteLength':
      return { operation: kind, text: asString(raw.text), encoding: asEncoding(raw.encoding) }
    case 'buffer.toString':
      return { operation: 'buffer.toString', encoding: asEncoding(raw.encoding), ...asRange(raw) }
    case 'hash.create': {
      const algorithm = asString(raw.algorithm)
      const hmac = asBoolean(raw.hmac)
      if (raw.text !== undefined) {
        const text = asString(raw.text)
        if (text.length > hmacKeyLimit) invalidRequest('HMAC key too large.')
        return { operation: 'hash.create', algorithm, hmac, text }
      }
      return { operation: 'hash.create', algorithm, hmac, ...asRange(raw, hmacKeyLimit) }
    }
    case 'hash.update': {
      const id = asInt(raw.id, 1, Number.MAX_SAFE_INTEGER)
      if (raw.text !== undefined) {
        return {
          operation: 'hash.update',
          id,
          text: asString(raw.text),
          encoding: raw.encoding === undefined ? 'utf8' : asEncoding(raw.encoding),
        }
      }
      return { operation: 'hash.update', id, ...asRange(raw) }
    }
    case 'hash.digest':
      return {
        operation: 'hash.digest',
        id: asInt(raw.id, 1, Number.MAX_SAFE_INTEGER),
        encoding: raw.encoding === undefined ? undefined : asEncoding(raw.encoding),
      }
    case 'hash.dispose':
      return { operation: 'hash.dispose', id: asInt(raw.id, 1, Number.MAX_SAFE_INTEGER) }
    case 'zlib': {
      const method = asString(raw.method)
      if (!zlibMethods.has(method)) invalidRequest('Unsupported zlib method.')
      const dictionary = raw.dictionary === undefined ? undefined : asRange(asObject(raw.dictionary))
      const options = asZlibOptions(raw.options)
      if (raw.text !== undefined) {
        return { operation: 'zlib', method: method as ZlibMethod, text: asString(raw.text), dictionary, options }
      }
      return { operation: 'zlib', method: method as ZlibMethod, ...asRange(raw), dictionary, options }
    }
    default:
      invalidRequest('Unsupported primitive operation.')
  }
}

/** Creates the per-Task primitive state behind the guest bridge, bounded by call count, bytes, and live instances. */
export function createNodejsPrimitives(platform: NodejsPrimitivePlatform): NodejsPrimitives {
  // Only streaming decodes keep a host decoder, so Tasks may create any number of guest TextDecoders.
  const decoders = new Map<number, TextDecoder>()
  let nextDecoder = 0
  const hashes = new Map<number, PlatformHash>()
  let nextHash = 0
  let remainingBytes = 64 * binaryLimit
  let calls = 0
  let closed = false
  const spend = (bytes: number): void => {
    remainingBytes -= bytes
    if (remainingBytes < 0) throw new Error('Native builtin byte limit exceeded.')
  }
  const binaryResult = (bytes: Uint8Array): ArrayBuffer => {
    if (bytes.byteLength > binaryLimit) throw new RangeError('Builtin result too large.')
    spend(bytes.byteLength)
    return (
      bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? bytes.buffer
        : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    ) as ArrayBuffer
  }
  const binaryView = (buffer: ArrayBuffer | undefined, offset: number, length: number): Uint8Array => {
    const byteLength = buffer?.byteLength ?? 0
    if (byteLength > binaryLimit || offset + length > byteLength) throw new RangeError('Invalid buffer range.')
    spend(length)
    return new Uint8Array(buffer ?? new ArrayBuffer(0), offset, length)
  }
  const textToInput = (text: string, encoding: Encoding, maxBytes = binaryLimit): Uint8Array => {
    spend(text.length * 2)
    const bytes = platform.Buffer.from(text, encoding)
    if (bytes.byteLength > maxBytes) throw new RangeError('Builtin payload too large.')
    spend(bytes.byteLength)
    return bytes
  }
  const serve = (source: string, buffer: ArrayBuffer | undefined, extra: ArrayBuffer | undefined): unknown => {
    const request = parseOperation(JSON.parse(source))
    switch (request.operation) {
      case 'buffer.from':
        spend(request.text.length * 2)
        return binaryResult(platform.Buffer.from(request.text, request.encoding))
      case 'buffer.byteLength':
        spend(request.text.length * 2)
        return { value: platform.Buffer.byteLength(request.text, request.encoding) }
      case 'buffer.toString': {
        const view = binaryView(buffer, request.offset, request.length)
        const value = platform.Buffer.from(view.buffer as ArrayBuffer, view.byteOffset, view.byteLength).toString(request.encoding)
        spend(value.length * 2)
        return { value }
      }
      case 'hash.create': {
        if (hashes.size >= 256) throw new Error('Hash instance limit exceeded.')
        const key = request.text !== undefined ? textToInput(request.text, 'utf8', hmacKeyLimit) : binaryView(buffer, request.offset!, request.length!)
        hashes.set(++nextHash, request.hmac ? platform.createHmac(request.algorithm, key) : platform.createHash(request.algorithm))
        return { value: nextHash }
      }
      case 'hash.update': {
        const hash = hashes.get(request.id)
        if (hash == null) throw new Error('Digest already called or hash destroyed.')
        try {
          const data = request.text !== undefined ? textToInput(request.text, request.encoding ?? 'utf8') : binaryView(buffer, request.offset!, request.length!)
          hash.update(data)
        } catch (error) {
          hashes.delete(request.id)
          hash.destroy()
          throw error
        }
        return { value: undefined }
      }
      case 'hash.digest': {
        const hash = hashes.get(request.id)
        if (hash == null) throw new Error('Digest already called or hash destroyed.')
        hashes.delete(request.id)
        try {
          const digest = hash.digest()
          if (request.encoding === undefined) return binaryResult(digest)
          if (digest.byteLength > binaryLimit) throw new RangeError('Builtin result too large.')
          spend(digest.byteLength)
          const value = platform.Buffer.from(digest.buffer as ArrayBuffer, digest.byteOffset, digest.byteLength).toString(request.encoding)
          spend(value.length * 2)
          return { value }
        } finally {
          hash.destroy()
        }
      }
      case 'hash.dispose':
        hashes.get(request.id)?.destroy()
        hashes.delete(request.id)
        return { value: undefined }
      case 'zlib': {
        const input = request.text !== undefined ? textToInput(request.text, 'utf8') : binaryView(buffer, request.offset!, request.length!)
        const options = {
          ...request.options,
          maxOutputLength: request.options.maxOutputLength ?? binaryLimit,
          dictionary: request.dictionary == null ? undefined : binaryView(extra, request.dictionary.offset, request.dictionary.length),
        }
        return binaryResult(platform.zlib[request.method](input, options))
      }
      case 'url': {
        let url: URL
        try {
          url = new URL(request.input, request.base)
        } catch (error) {
          if (!(error instanceof TypeError)) throw error
          return { value: null }
        }
        if (request.change != null) url[request.change.key] = request.change.value
        if (request.entries != null) url.search = new URLSearchParams(request.entries).toString()
        const { hash, host, hostname, href, origin, password, pathname, port, protocol, search, username } = url
        return { value: { hash, host, hostname, href, origin, password, pathname, port, protocol, search, username, entries: [...url.searchParams] } }
      }
      case 'params.parse':
        return { value: [...new URLSearchParams(request.input)] }
      case 'params.stringify':
        return { value: new URLSearchParams(request.entries).toString() }
      case 'encode': {
        const encoded = new TextEncoder().encode(request.text)
        if (encoded.byteLength > binaryLimit) throw new Error('Builtin result too large.')
        return encoded.buffer
      }
      case 'decoder':
        return { value: { encoding: new TextDecoder(request.label, { fatal: request.fatal, ignoreBOM: request.ignoreBOM }).encoding } }
      case 'decode': {
        const byteLength = buffer?.byteLength ?? 0
        if (request.offset + request.length > byteLength) throw new RangeError('Invalid buffer range.')
        const stored = request.id == null ? undefined : decoders.get(request.id)
        if (request.id != null && stored == null) throw new TypeError('Unknown TextDecoder.')
        const decoder = stored ?? new TextDecoder(request.label, { fatal: request.fatal, ignoreBOM: request.ignoreBOM })
        let text: string
        try {
          text = decoder.decode(new Uint8Array(buffer ?? new ArrayBuffer(0), request.offset, request.length), { stream: request.stream })
        } catch (error) {
          if (request.id != null) decoders.delete(request.id)
          throw error
        }
        if (!request.stream) {
          if (request.id != null) decoders.delete(request.id)
          return { value: { text } }
        }
        if (stored != null) return { value: { id: request.id, text } }
        if (decoders.size >= 256) throw new Error('TextDecoder limit exceeded.')
        decoders.set(++nextDecoder, decoder)
        return { value: { id: nextDecoder, text } }
      }
      case 'atob':
        return { value: atob(request.text) }
      case 'btoa':
        return { value: btoa(request.text) }
      case 'random':
        return crypto.getRandomValues(new Uint8Array(request.length)).buffer
      case 'uuid':
        return { value: crypto.randomUUID() }
    }
  }
  return {
    call(source, buffer, extra) {
      if (closed) throw new Error('Task completed.')
      if (++calls > 100_000) throw new Error('Builtin call limit exceeded.')
      if (source.length > binaryLimit) throw new Error('Builtin payload too large.')
      try {
        const result = serve(source, buffer, extra)
        if (result instanceof ArrayBuffer) return result
        const serialized = JSON.stringify(result)
        if (serialized.length > binaryLimit) throw new Error('Builtin result too large.')
        return serialized
      } catch (error) {
        const code = error instanceof Error && 'code' in error && typeof error.code == 'string' ? error.code : undefined
        return JSON.stringify({
          error: { name: error instanceof Error ? error.name : 'Error', message: String(error instanceof Error ? error.message : error), code },
        })
      }
    },
    close() {
      closed = true
      decoders.clear()
      for (const hash of hashes.values()) hash.destroy()
      hashes.clear()
    },
  }
}
