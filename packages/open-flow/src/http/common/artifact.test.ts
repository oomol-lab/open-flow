import { describe, expect, it } from 'vitest'
import { ConnectorProxyResponseInvalid, connectorProxyArtifactContent, connectorProxyConfigSchema, connectorProxyTask } from '../../connector/common/proxy.ts'
import { artifactContentDisposition, artifactMediaType, artifactName, isArtifactRef } from './artifact.ts'
import { buildHttpRequest, httpRequestArtifactIds, httpRequestConfigSchema, httpRequestInputs, httpRequestIssues, httpRequestTask } from './httpRequest.ts'

const ref = { kind: 'artifact', id: 'a1', name: 'claimed.exe', mediaType: 'text/html', size: 1, digest: 'sha256:x' }
const config = (value: unknown) => httpRequestConfigSchema.parse(value)

describe('Artifact metadata', () => {
  it('derives safe download names and media types', () => {
    expect(artifactName(`attachment; filename*=UTF-8''%E6%8A%A5%E5%91%8A.csv; filename="fallback.csv"`, undefined)).toBe('报告.csv')
    expect(artifactName('attachment; filename="a \\"b\\".txt"', undefined)).toBe('a "b".txt')
    expect(artifactName('attachment; filename=../../etc/passwd', undefined)).toBe('.._.._etc_passwd')
    expect(artifactName(null, 'https://example.com/files/report%20final.pdf?download=1')).toBe('report final.pdf')
    expect(artifactName(null, 'https://example.com/')).toBe('response')
    expect(artifactName(`filename="${'x'.repeat(300)}"`, undefined)).toHaveLength(255)
    // 255 code points of emoji are 510 UTF-16 units; the name must not end in half of a surrogate pair.
    const emoji = artifactName(`filename*=UTF-8''${encodeURIComponent('😀'.repeat(300))}`, undefined)!
    expect([...emoji]).toHaveLength(255)
    expect(() => encodeURIComponent(emoji)).not.toThrow()
    expect(artifactMediaType('Application/PDF; charset=binary')).toBe('application/pdf')
    expect(artifactMediaType('text/html\r\nx-injected: 1')).toBeUndefined()
    expect(artifactMediaType(undefined)).toBeUndefined()
  })

  it('encodes Content-Disposition with an ASCII fallback and an RFC 6266 UTF-8 name', () => {
    expect(artifactContentDisposition('发票 "1".pdf')).toBe(`attachment; filename="__ _1_.pdf"; filename*=UTF-8''%E5%8F%91%E7%A5%A8%20%221%22.pdf`)
    expect(() => new Headers({ 'content-disposition': artifactContentDisposition('a\r\nb') })).not.toThrow()
  })

  it('recognizes Artifact references by shape only', () => {
    expect(isArtifactRef(ref)).toBe(true)
    expect(isArtifactRef({ kind: 'artifact', id: '' })).toBe(false)
    expect(isArtifactRef(['artifact'])).toBe(false)
  })
})

describe('HTTP Artifact bodies', () => {
  it('uses only host-resolved bytes and metadata for binary and multipart bodies', async () => {
    const binary = config({ method: 'PUT', bodyFormat: 'binary' })
    expect(httpRequestArtifactIds(binary, { url: 'https://example.com', body: ref })).toEqual(['a1'])
    expect(() => buildHttpRequest(binary, { url: 'https://example.com', body: ref })).toThrow(/not available/)
    const resolved = new Map([['a1', { bytes: new Uint8Array([1, 2]), name: 'stored.bin' }]])
    const built = buildHttpRequest(binary, { url: 'https://example.com', body: ref }, resolved)
    expect(new Headers(built.init.headers).get('content-type')).toBe('application/octet-stream')
    expect([...new Uint8Array(await new Response(built.init.body).arrayBuffer())]).toEqual([1, 2])

    const multipart = config({ method: 'POST', bodyFormat: 'multipart', bodyFields: ['file', 'meta'] })
    expect(httpRequestArtifactIds(multipart, { 'url': 'https://example.com', 'body.file': [ref, ref], 'body.meta': 'x' })).toEqual(['a1'])
    const form = buildHttpRequest(multipart, { 'url': 'https://example.com', 'body.file': ref, 'body.meta': true }, resolved).init.body as FormData
    expect((form.get('file') as File).name).toBe('stored.bin')
    expect(form.get('meta')).toBe('true')
    expect(() => buildHttpRequest(multipart, { 'url': 'https://example.com', 'body.meta': { nested: true } })).toThrow()
    const sparse = buildHttpRequest(multipart, { 'url': 'https://example.com', 'body.meta': null }).init.body as FormData
    expect([...sparse.keys()]).toEqual([])
  })

  it('keeps the source of a renamed multipart field', () => {
    const before = httpRequestTask(config({ method: 'POST', bodyFormat: 'multipart', bodyFields: ['file', 'note'] }))
    const after = httpRequestTask(config({ method: 'POST', bodyFormat: 'multipart', bodyFields: ['file', 'memo'] }))
    const note = { kind: 'value' as const, value: 'x' }
    expect(httpRequestInputs({ 'body.note': note }, before, after)).toEqual({ 'body.memo': note })
  })

  it('reports duplicate or empty multipart field names', () => {
    expect(httpRequestIssues(config({ method: 'POST', bodyFormat: 'multipart', bodyFields: ['a', 'a', ''] })).map((issue) => issue.index)).toEqual([1, 2])
  })
})

describe('Provider API Artifact responses', () => {
  it('declares a non-nullable Artifact body and keeps base64 bytes exactly', () => {
    const task = connectorProxyTask(connectorProxyConfigSchema.parse({ providerId: 'drive', responseFormat: 'artifact' }))
    expect(task.outputs.find((port) => 'handle' in port && port.handle == 'body')).toEqual({
      handle: 'body',
      jsonSchema: { contentMediaType: 'oomol/artifact' },
      nullable: false,
    })
    const binary = connectorProxyArtifactContent(
      { data: btoa(String.fromCharCode(0, 255, 16)), status: 200, bodyEncoding: 'base64', headers: { 'Content-Type': 'image/png' } },
      '/files/abc/photo.png?alt=media',
    )
    expect(binary).toEqual({ bytes: new Uint8Array([0, 255, 16]), mediaType: 'image/png', name: 'photo.png' })
    expect(connectorProxyArtifactContent({ data: { ok: true }, status: 200 }, '/status')).toMatchObject({
      bytes: new TextEncoder().encode('{"ok":true}'),
      mediaType: 'application/json',
    })
    expect(connectorProxyArtifactContent({ data: null, status: 204 }, '/')).toEqual({ bytes: new Uint8Array(0), name: 'response' })
    for (const data of [{ bytes: [0] }, 'not base64!', null])
      expect(() => connectorProxyArtifactContent({ data, status: 200, bodyEncoding: 'base64' }, '/')).toThrow(ConnectorProxyResponseInvalid)
  })
})
