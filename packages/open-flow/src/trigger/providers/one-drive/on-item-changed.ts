import type { ConnectorProxyResult } from '../../../connector/common/proxy.ts'
import type { JsonValue, TriggerKeySnapshot } from '../../../flow/common/change.ts'
import type { PollContext, PollDefinition, PollEvent } from '../../common/poll.ts'

import { canonicalJsonBytes, digestBytes } from '../../../flow/common/encoding.ts'
import { PermanentPollError, PollConnectionError, TransientPollError } from '../../common/poll.ts'

type Change = 'created' | 'deleted' | 'updated'
type ItemType = 'file' | 'folder'

interface Config {
  readonly events: readonly Change[]
  readonly itemId: string
  readonly itemTypes: readonly ItemType[]
  readonly maxItemsPerPoll: number
  readonly parentFolderId: string
}

interface Checkpoint {
  readonly deltaToken: string
  readonly lastPolledAt: string
  readonly pageToken?: string
}

interface Item {
  readonly createdDateTime?: string
  readonly deleted?: object
  readonly eTag?: string
  readonly file?: { readonly mimeType?: string }
  readonly fileSystemInfo?: { readonly createdDateTime?: string; readonly lastModifiedDateTime?: string }
  readonly folder?: object
  readonly id?: string
  readonly lastModifiedDateTime?: string
  readonly name?: string
  readonly parentReference?: { readonly driveId?: string; readonly id?: string }
  readonly root?: object
  readonly size?: number
  readonly webUrl?: string
}

interface Page {
  readonly '@odata.deltaLink'?: string
  readonly '@odata.nextLink'?: string
  readonly 'value'?: readonly Item[]
}

const eventSchema = {
  additionalProperties: false,
  properties: {
    changeType: { enum: ['created', 'updated', 'deleted'], type: 'string' },
    createdDateTime: { type: ['string', 'null'] },
    driveId: { type: ['string', 'null'] },
    eTag: { type: ['string', 'null'] },
    itemId: { type: 'string' },
    itemType: { enum: ['file', 'folder'], type: 'string' },
    lastModifiedDateTime: { type: ['string', 'null'] },
    mimeType: { type: ['string', 'null'] },
    name: { type: 'string' },
    parentFolderId: { type: ['string', 'null'] },
    size: { type: ['number', 'null'] },
    webUrl: { type: 'string' },
  },
  required: [
    'itemId',
    'name',
    'changeType',
    'itemType',
    'size',
    'mimeType',
    'webUrl',
    'parentFolderId',
    'driveId',
    'createdDateTime',
    'lastModifiedDateTime',
    'eTag',
  ],
  type: 'object',
} as const

const snapshot = {
  configSchema: {
    additionalProperties: false,
    properties: {
      events: {
        default: ['created', 'updated'],
        items: { enum: ['created', 'updated', 'deleted'], type: 'string' },
        minItems: 1,
        type: 'array',
        uniqueItems: true,
      },
      itemId: { default: '', type: 'string' },
      itemTypes: {
        default: ['file'],
        items: { enum: ['file', 'folder'], type: 'string' },
        minItems: 1,
        type: 'array',
        uniqueItems: true,
      },
      maxItemsPerPoll: { default: 50, maximum: 200, minimum: 1, type: 'integer' },
      parentFolderId: { default: '', type: 'string' },
    },
    title: 'OneDrive Item Change Config',
    type: 'object',
  },
  definitionVersion: 1,
  description: 'Polls the OneDrive change feed and triggers when a file or folder is created, updated or deleted.',
  displayName: 'File or Folder Changed',
  key: 'one_drive.on_item_changed',
  name: 'on_item_changed',
  payloadSchema: {
    additionalProperties: false,
    properties: { events: { items: eventSchema, type: 'array' } },
    required: ['events'],
    title: 'OneDrive Item Change Payload',
    type: 'object',
  },
  provider: 'one_drive',
  type: 'poll',
} as const satisfies TriggerKeySnapshot & { readonly type: 'poll' }

export const oneDriveItemChanged: PollDefinition = {
  snapshot,
  async poll(context) {
    const config = resolveConfig(context.config)
    if (context.checkpoint === null) return { checkpoint: (await seed(context, config)) as unknown as JsonValue, events: [] }
    const checkpoint = readCheckpoint(context.checkpoint)
    const { items, next } = await changedItems(context, checkpoint, config.maxItemsPerPoll)
    const events: PollEvent[] = []
    let filtered = 0
    for (const [id, item] of items) {
      const result = await evaluate(id, item, config, checkpoint)
      if (result == 'structural') continue
      if (result == 'filtered') filtered += 1
      else events.push(result)
    }
    return { checkpoint: next.checkpoint as unknown as JsonValue, events, filtered, ...(next.hasMore ? { hasMore: true } : {}) }
  },
}

function resolveConfig(value: Readonly<Record<string, JsonValue>>): Config {
  return {
    events: (value.events as readonly Change[] | undefined) ?? ['created', 'updated'],
    itemId: ((value.itemId as string | undefined) ?? '').trim(),
    itemTypes: (value.itemTypes as readonly ItemType[] | undefined) ?? ['file'],
    maxItemsPerPoll: (value.maxItemsPerPoll as number | undefined) ?? 50,
    parentFolderId: ((value.parentFolderId as string | undefined) ?? '').trim(),
  }
}

async function seed(context: PollContext, config: Config): Promise<Checkpoint> {
  const result = await get(context, '/me/drive/root/delta', { token: 'latest' })
  if (result.status == 404) throw new PermanentPollError('OneDrive is not provisioned for this account.')
  success(result, 'delta seeding')
  const link = (record(result.data) as Page | undefined)?.['@odata.deltaLink']
  const token = link == null ? null : parseToken(link)
  if (token == null) throw new TransientPollError('OneDrive delta seeding response has no delta token.')
  await validateItem(context, 'parentFolderId', config.parentFolderId)
  await validateItem(context, 'itemId', config.itemId)
  return { deltaToken: token, lastPolledAt: context.now.toISOString() }
}

async function validateItem(context: PollContext, field: string, id: string): Promise<void> {
  if (id.length == 0) return
  const result = await get(context, `/me/drive/items/${encodeURIComponent(id)}`, {})
  if (result.status == 400 || result.status == 404) throw new PermanentPollError(`OneDrive ${field} does not identify an item in this drive.`)
  success(result, `${field} validation`)
}

function readCheckpoint(value: JsonValue): Checkpoint {
  const checkpoint = record(value)
  if (
    typeof checkpoint?.deltaToken != 'string' ||
    checkpoint.deltaToken.length == 0 ||
    typeof checkpoint.lastPolledAt != 'string' ||
    Number.isNaN(Date.parse(checkpoint.lastPolledAt))
  ) {
    throw new PermanentPollError('OneDrive checkpoint is invalid; recreate the Trigger.')
  }
  return {
    deltaToken: checkpoint.deltaToken,
    lastPolledAt: checkpoint.lastPolledAt,
    ...(typeof checkpoint.pageToken == 'string' && checkpoint.pageToken.length > 0 ? { pageToken: checkpoint.pageToken } : {}),
  }
}

async function changedItems(
  context: PollContext,
  checkpoint: Checkpoint,
  pageSize: number,
): Promise<{
  readonly items: ReadonlyMap<string, Item>
  readonly next: { readonly checkpoint: Checkpoint; readonly hasMore: boolean }
}> {
  const items = new Map<string, Item>()
  let token = checkpoint.pageToken ?? checkpoint.deltaToken
  for (let page = 0; page < 5; page += 1) {
    const result = await get(context, '/me/drive/root/delta', { $top: pageSize, token })
    deltaSuccess(result)
    const parsed = (record(result.data) ?? {}) as Page
    for (const item of parsed.value ?? []) if (item.id != null && item.id.length > 0) items.set(item.id, item)
    if (parsed['@odata.deltaLink']) {
      return {
        items,
        next: { checkpoint: { deltaToken: requireToken(parsed['@odata.deltaLink']), lastPolledAt: context.now.toISOString() }, hasMore: false },
      }
    }
    if (!parsed['@odata.nextLink']) throw new TransientPollError('OneDrive delta response has no continuation link.')
    token = requireToken(parsed['@odata.nextLink'])
  }
  return {
    items,
    next: {
      checkpoint: { deltaToken: checkpoint.deltaToken, lastPolledAt: checkpoint.lastPolledAt, pageToken: token },
      hasMore: true,
    },
  }
}

async function evaluate(id: string, item: Item, config: Config, checkpoint: Checkpoint): Promise<PollEvent | 'filtered' | 'structural'> {
  if (item.root != null) return 'structural'
  const itemType = type(item)
  if (itemType == null) return 'structural'
  const change = item.deleted != null ? 'deleted' : createdAfter(item.createdDateTime, new Date(checkpoint.lastPolledAt)) ? 'created' : 'updated'
  if (!config.events.includes(change) || !config.itemTypes.includes(itemType)) return 'filtered'
  if (config.parentFolderId.length > 0 && item.parentReference?.id !== config.parentFolderId) return 'filtered'
  if (config.itemId.length > 0 && id !== config.itemId) return 'filtered'
  return await event(id, item, change, itemType, checkpoint.deltaToken)
}

function type(item: Item): ItemType | null {
  if (item.file != null) return 'file'
  if (item.folder != null) return 'folder'
  return item.deleted != null ? 'file' : null
}

async function event(id: string, item: Item, change: Change, itemType: ItemType, deltaToken: string): Promise<PollEvent> {
  // Continuation pages share a deletion identity, but later delta cycles must not.
  return {
    dedupeKey:
      item.deleted != null ? await digestBytes(canonicalJsonBytes(['one-drive-deleted', deltaToken, id])) : `${id}:${item.eTag ?? item.lastModifiedDateTime}`,
    payload: {
      changeType: change,
      createdDateTime: item.createdDateTime ?? item.fileSystemInfo?.createdDateTime ?? null,
      driveId: item.parentReference?.driveId ?? null,
      eTag: item.eTag ?? null,
      itemId: id,
      itemType,
      lastModifiedDateTime: item.lastModifiedDateTime ?? item.fileSystemInfo?.lastModifiedDateTime ?? null,
      mimeType: item.file?.mimeType ?? null,
      name: item.name ?? '',
      parentFolderId: item.parentReference?.id ?? null,
      size: item.size ?? null,
      webUrl: item.webUrl ?? '',
    },
  }
}

async function get(context: PollContext, endpoint: string, query: Readonly<Record<string, number | string>>): Promise<ConnectorProxyResult> {
  try {
    return await context.connector.execute({ endpoint, method: 'GET', query }, context.signal)
  } catch (cause) {
    throw new TransientPollError(`OneDrive proxy request to ${endpoint} failed.`, { cause })
  }
}

function deltaSuccess(result: ConnectorProxyResult): void {
  if (result.status == 410 && resyncRequired(result.data)) throw new PermanentPollError('OneDrive delta token expired; recreate the Trigger.')
  if (result.status == 404) throw new PermanentPollError('OneDrive is not provisioned for this account.')
  if (result.status == 400) throw new PermanentPollError('OneDrive rejected the delta token; recreate the Trigger.')
  success(result, 'delta list')
}

function success(result: ConnectorProxyResult, operation: string): void {
  if (result.status >= 200 && result.status < 300) return
  if (result.status == 401 || result.status == 403) throw new PollConnectionError(`OneDrive ${operation} rejected the Connection.`)
  throw new TransientPollError(`OneDrive ${operation} failed with status ${result.status}.`)
}

function resyncRequired(data: unknown): boolean {
  let value = record(data)?.error
  while (value != null) {
    const error = record(value)
    if (error == null) break
    if (error.code == 'resyncChangesApplyDifferences' || error.code == 'resyncChangesUploadDifferences') return true
    value = error.innerError ?? error.innererror
  }
  return false
}

function requireToken(link: string): string {
  const token = parseToken(link)
  if (token == null) throw new TransientPollError('OneDrive delta link has no token.')
  return token
}

function parseToken(link: string): string | null {
  const raw = /[?&]token=([^&#]+)/.exec(link)?.[1] ?? /\(token='([^']+)'\)/.exec(link)?.[1]
  if (raw == null) return null
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

function createdAfter(value: string | undefined, boundary: Date): boolean {
  if (value == null || value.length == 0) return false
  const date = new Date(value)
  return !Number.isNaN(date.getTime()) && date >= boundary
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value == 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}
