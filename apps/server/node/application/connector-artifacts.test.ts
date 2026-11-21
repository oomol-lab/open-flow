import type { JsonValue } from '@oomol-lab/open-flow/flow-change'
import type { ConnectorHost } from '../deployment/connector-contract.ts'
import type { RunStore, StoredArtifact } from '../storage/run-store.ts'
import type { ArtifactEvent } from './run-artifacts.ts'

import { describe, expect, it } from 'vitest'
import { bridgeConnectorOutputArtifacts, prepareConnectorInputsWithArtifacts } from './connector-artifacts.ts'
import { RunArtifacts } from './run-artifacts.ts'

function createMemoryArtifactStore() {
  const store = new Map<string, { artifact: StoredArtifact; content: Uint8Array }>()
  const runs = {
    putArtifact(runId: string, artifact: StoredArtifact, content: Uint8Array) {
      store.set(`${runId}:${artifact.id}`, { artifact, content: Uint8Array.from(content) })
    },
    artifactBytes(runId: string) {
      let total = 0
      for (const [key, entry] of store) if (key.startsWith(`${runId}:`)) total += entry.content.byteLength
      return total
    },
    readArtifact(runId: string, artifactId: string, offset: number, length: number) {
      const entry = store.get(`${runId}:${artifactId}`)
      if (!entry) return undefined
      return { content: entry.content.slice(offset, offset + length), size: entry.content.byteLength }
    },
  } as unknown as RunStore
  return { artifacts: new RunArtifacts(runs), store }
}

describe('Connector Transit File <-> ArtifactRef bridge', () => {
  it('converts OpenConnector transit file outputs into ArtifactRef and emits node.artifact', async () => {
    const { artifacts } = createMemoryArtifactStore()
    const events: ArtifactEvent[] = []
    const connector = {
      async downloadTransitFile(url: string) {
        expect(url).toBe('https://connector.example/api/files/tf-1')
        return { content: new TextEncoder().encode('pdf-payload'), mediaType: 'application/pdf' }
      },
    } as unknown as ConnectorHost

    const output = await bridgeConnectorOutputArtifacts(
      {
        fileId: 'tf-1',
        downloadUrl: 'https://connector.example/api/files/tf-1',
        sizeBytes: 11,
        name: 'invoice.pdf',
        mimeType: 'application/pdf',
      },
      {
        runId: 'run-1',
        nodeId: 'node-1',
        jobId: 'job-1',
        artifacts,
        connector,
        signal: new AbortController().signal,
        emit: async (event) => {
          events.push(event)
        },
      },
    )

    expect(events).toHaveLength(1)
    expect(output).toMatchObject({
      fileId: 'tf-1',
      name: 'invoice.pdf',
      artifact: {
        kind: 'artifact',
        name: 'invoice.pdf',
        mediaType: 'application/pdf',
        size: 11,
      },
    })
    const ref = (output as { artifact: { id: string } }).artifact
    const stored = artifacts.readAllBytes('run-1', ref.id)
    expect(new TextDecoder().decode(stored.content)).toBe('pdf-payload')
  })

  it('converts Hosted Connector transitUrl outputs into ArtifactRef', async () => {
    const { artifacts } = createMemoryArtifactStore()
    const connector = {
      async downloadTransitFile(url: string) {
        expect(url).toBe('https://cdn.example/transit/att.png')
        return { content: new Uint8Array([1, 2, 3, 4]), mediaType: 'image/png' }
      },
    } as unknown as ConnectorHost

    const output = await bridgeConnectorOutputArtifacts(
      {
        attachmentId: 'att-1',
        filename: 'att.png',
        mimeType: 'image/png',
        sizeBytes: 4,
        transitUrl: 'https://cdn.example/transit/att.png',
      },
      {
        runId: 'run-2',
        nodeId: 'node-2',
        jobId: 'job-2',
        artifacts,
        connector,
        signal: new AbortController().signal,
        emit: async () => {},
      },
    )

    expect(output).toMatchObject({
      transitUrl: 'https://cdn.example/transit/att.png',
      artifact: {
        kind: 'artifact',
        name: 'att.png',
        mediaType: 'image/png',
        size: 4,
      },
    })
  })

  it('converts ArtifactRef inputs into transit file object or downloadUrl based on port schema', async () => {
    const { artifacts } = createMemoryArtifactStore()
    const ref = await artifacts.storeBytes(
      'run-3',
      'node-0',
      'job-0',
      { name: 'notes.txt', mediaType: 'text/plain', content: new TextEncoder().encode('hello') },
      async () => {},
    )

    const uploads: { name: string; text: string }[] = []
    const connector = {
      async uploadTransitFile(file: { name: string; mediaType?: string; content: Uint8Array }) {
        uploads.push({ name: file.name, text: new TextDecoder().decode(file.content) })
        return {
          fileId: 'tf-up-1',
          downloadUrl: 'https://connector.example/api/files/tf-up-1',
          sizeBytes: file.content.byteLength,
          name: file.name,
          mimeType: file.mediaType ?? 'application/octet-stream',
        }
      },
    } as unknown as ConnectorHost

    const prepared = await prepareConnectorInputsWithArtifacts(
      [
        { handle: 'file', jsonSchema: { type: 'object' } },
        { handle: 'fileUrl', jsonSchema: { type: 'string', format: 'uri' } },
      ],
      {
        file: ref as unknown as JsonValue,
        fileUrl: ref as unknown as JsonValue,
      },
      {
        runId: 'run-3',
        artifacts,
        connector,
        signal: new AbortController().signal,
      },
    )

    expect(uploads).toHaveLength(2)
    expect(prepared).toEqual({
      file: { fileId: 'tf-up-1', name: 'notes.txt', mimeType: 'text/plain' },
      fileUrl: 'https://connector.example/api/files/tf-up-1',
    })
  })
})
