import type { EngineContract } from './engineContract.ts'

import * as z from 'zod'
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
const range = { offset: z.number().int().nonnegative(), length: z.number().int().min(0).max(binaryLimit) }
const encoding = z.enum(['utf8', 'utf-8', 'hex', 'base64', 'ascii', 'latin1', 'binary', 'ucs2', 'ucs-2', 'utf16le', 'utf-16le'])
const operation = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('url'),
    input: z.string(),
    base: z.string().optional(),
    change: z
      .object({ key: z.enum(['href', 'protocol', 'username', 'password', 'host', 'hostname', 'port', 'pathname', 'search', 'hash']), value: z.string() })
      .optional(),
    entries: z.array(z.tuple([z.string(), z.string()])).optional(),
  }),
  z.object({ operation: z.literal('params.parse'), input: z.string() }),
  z.object({ operation: z.literal('params.stringify'), entries: z.array(z.tuple([z.string(), z.string()])) }),
  z.object({ operation: z.literal('encode'), text: z.string() }),
  z.object({ operation: z.literal('decoder'), label: z.string(), fatal: z.boolean(), ignoreBOM: z.boolean() }),
  z.object({ operation: z.literal('decode'), id: z.number().int().nonnegative(), ...range, stream: z.boolean() }),
  z.object({ operation: z.enum(['atob', 'btoa']), text: z.string() }),
  z.object({ operation: z.literal('random'), length: z.number().int().min(0).max(65536) }),
  z.object({ operation: z.literal('uuid') }),
  z.object({ operation: z.enum(['buffer.from', 'buffer.byteLength']), text: z.string(), encoding }),
  z.object({ operation: z.literal('buffer.toString'), encoding, ...range }),
  z.object({ operation: z.literal('hash.create'), algorithm: z.string(), hmac: z.boolean(), ...range, length: z.number().int().min(0).max(65536) }),
  z.object({ operation: z.literal('hash.update'), id: z.number().int().positive(), ...range }),
  z.object({ operation: z.enum(['hash.digest', 'hash.dispose']), id: z.number().int().positive() }),
  z.object({
    operation: z.literal('zlib'),
    method: z.enum(['gzipSync', 'gunzipSync', 'deflateSync', 'inflateSync', 'deflateRawSync', 'inflateRawSync', 'unzipSync']),
    ...range,
    dictionary: z.object(range).optional(),
    options: z.object({
      level: z.number().optional(),
      windowBits: z.number().optional(),
      memLevel: z.number().optional(),
      strategy: z.number().optional(),
      chunkSize: z.number().int().min(64).max(binaryLimit).optional(),
      flush: z.number().optional(),
      finishFlush: z.number().optional(),
      maxOutputLength: z.number().int().min(1).max(binaryLimit).optional(),
    }),
  }),
])

/** Creates the per-Task primitive state behind the guest bridge, bounded by call count, bytes, and live instances. */
export function createNodejsPrimitives(platform: NodejsPrimitivePlatform): NodejsPrimitives {
  const decoders: TextDecoder[] = []
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
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  }
  const binaryView = (buffer: ArrayBuffer | undefined, offset: number, length: number): Uint8Array => {
    const byteLength = buffer?.byteLength ?? 0
    if (byteLength > binaryLimit || offset + length > byteLength) throw new RangeError('Invalid buffer range.')
    spend(length)
    return new Uint8Array(buffer ?? new ArrayBuffer(0), offset, length)
  }
  const serve = (source: string, buffer: ArrayBuffer | undefined, extra: ArrayBuffer | undefined): unknown => {
    const request = operation.parse(JSON.parse(source))
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
        const key = binaryView(buffer, request.offset, request.length)
        hashes.set(++nextHash, request.hmac ? platform.createHmac(request.algorithm, key) : platform.createHash(request.algorithm))
        return { value: nextHash }
      }
      case 'hash.update': {
        const hash = hashes.get(request.id)
        if (hash == null) throw new Error('Digest already called or hash destroyed.')
        try {
          hash.update(binaryView(buffer, request.offset, request.length))
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
          return binaryResult(hash.digest())
        } finally {
          hash.destroy()
        }
      }
      case 'hash.dispose':
        hashes.get(request.id)?.destroy()
        hashes.delete(request.id)
        return { value: undefined }
      case 'zlib': {
        const input = binaryView(buffer, request.offset, request.length)
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
      case 'decoder': {
        if (decoders.length >= 256) throw new Error('TextDecoder limit exceeded.')
        const decoder = new TextDecoder(request.label, { fatal: request.fatal, ignoreBOM: request.ignoreBOM })
        decoders.push(decoder)
        return { value: { id: decoders.length - 1, encoding: decoder.encoding } }
      }
      case 'decode': {
        const decoder = decoders[request.id]
        if (decoder == null) throw new TypeError('Unknown TextDecoder.')
        const byteLength = buffer?.byteLength ?? 0
        if (request.offset + request.length > byteLength) throw new RangeError('Invalid buffer range.')
        return { value: decoder.decode(new Uint8Array(buffer ?? new ArrayBuffer(0), request.offset, request.length), { stream: request.stream }) }
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
      decoders.length = 0
      for (const hash of hashes.values()) hash.destroy()
      hashes.clear()
    },
  }
}
