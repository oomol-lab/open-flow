import type { ConnectorProxy, ConnectorProxyRequest } from '../src/connector/common/proxy.ts'
import type { JsonValue } from '../src/flow/common/change.ts'

import { describe, expect, it } from 'vitest'
import { googleDriveStartPageToken, readGoogleDriveChanges } from '../src/trigger/providers/google-drive/changes.ts'

describe('Google Drive change source', () => {
  it('establishes an initial cursor and reads every page without a notification or subscription', async () => {
    const calls: ConnectorProxyRequest[] = []
    const replies: JsonValue[] = [
      { startPageToken: 'initial' },
      { changes: [{ fileId: 'first', removed: false }], nextPageToken: 'continuation' },
      { changes: [{ fileId: 'second', removed: true }], newStartPageToken: 'next-scan' },
      { newStartPageToken: 'next-scan' },
    ]
    const connector: ConnectorProxy = {
      async execute(request) {
        calls.push(request)
        return { data: replies.shift()!, status: 200 }
      },
    }
    const context = { config: { driveId: 'shared-drive' }, connector }
    const initial = await googleDriveStartPageToken(context)
    const first = await readGoogleDriveChanges(context, { pageToken: initial })
    const second = await readGoogleDriveChanges(context, first.checkpoint)
    const empty = await readGoogleDriveChanges(context, second.checkpoint)

    expect(first).toEqual({
      changes: [{ fileId: 'first', removed: false }],
      checkpoint: { pageToken: 'continuation' },
      dedupeKey: 'shared-drive:initial',
      hasMore: true,
    })
    expect(second).toEqual({
      changes: [{ fileId: 'second', removed: true }],
      checkpoint: { pageToken: 'next-scan' },
      dedupeKey: 'shared-drive:continuation',
      hasMore: false,
    })
    expect(empty).toMatchObject({ changes: [], checkpoint: second.checkpoint, hasMore: false })
    expect(calls.map(({ endpoint }) => endpoint)).toEqual(['/changes/startPageToken', '/changes', '/changes', '/changes'])
    expect(calls.slice(1).map(({ query }) => query?.pageToken)).toEqual(['initial', 'continuation', 'next-scan'])
    expect(calls.every(({ query }) => query?.driveId === 'shared-drive')).toBe(true)
  })

  it.each([
    { changes: [], nextPageToken: 'initial' },
    { changes: [{ fileId: 'file' }] },
    { changes: 'invalid', newStartPageToken: 'next' },
    { changes: [null], newStartPageToken: 'next' },
    { changes: [[]], newStartPageToken: 'next' },
    { changes: [], nextPageToken: 42, newStartPageToken: 'next' },
    { changes: [], nextPageToken: '', newStartPageToken: 'next' },
    { changes: [], newStartPageToken: null },
  ])('rejects an invalid page without modifying the input cursor: %j', async (data) => {
    const cursor = { pageToken: 'initial' }
    const connector: ConnectorProxy = { execute: async () => ({ data, status: 200 }) }
    await expect(readGoogleDriveChanges({ config: {}, connector }, cursor)).rejects.toThrow('Google Drive changes')
    expect(cursor).toEqual({ pageToken: 'initial' })
  })

  it('passes cancellation to both initialization and page reads', async () => {
    const controller = new AbortController()
    const signals: (AbortSignal | undefined)[] = []
    const connector: ConnectorProxy = {
      async execute(request, signal) {
        signals.push(signal)
        return {
          data: request.endpoint.endsWith('startPageToken') ? { startPageToken: 'initial' } : { newStartPageToken: 'next' },
          status: 200,
        }
      },
    }
    const context = { config: {}, connector, signal: controller.signal }
    await googleDriveStartPageToken(context)
    await readGoogleDriveChanges(context, { pageToken: 'initial' })
    expect(signals).toEqual([controller.signal, controller.signal])
  })

  it('retains the saved cursor when reading fails and can retry that cursor', async () => {
    const cursor = { pageToken: 'saved' }
    let attempts = 0
    const calls: ConnectorProxyRequest[] = []
    const connector: ConnectorProxy = {
      async execute(request) {
        calls.push(request)
        attempts += 1
        return attempts === 1 ? { data: {}, status: 503 } : { data: { newStartPageToken: 'next' }, status: 200 }
      },
    }
    const context = { config: {}, connector }
    await expect(readGoogleDriveChanges(context, cursor)).rejects.toThrow('temporarily unavailable')
    await expect(readGoogleDriveChanges(context, cursor)).resolves.toMatchObject({ checkpoint: { pageToken: 'next' } })
    expect(calls.map(({ query }) => query?.pageToken)).toEqual(['saved', 'saved'])
    expect(cursor).toEqual({ pageToken: 'saved' })
  })
})
