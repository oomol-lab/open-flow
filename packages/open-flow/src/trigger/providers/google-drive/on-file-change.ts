import type { ConnectorProxyResult } from '../../../connector/common/proxy.ts'
import type { JsonValue, TriggerKeySnapshot } from '../../../flow/common/change.ts'
import type { PollContext, PollDefinition, PollEvent, PollResult } from '../../common/poll.ts'

import { PermanentPollError, PollConnectionError, TransientPollError } from '../../common/poll.ts'

type Change = 'created' | 'updated'
type ItemType = 'file' | 'folder'

interface Config {
  readonly changeType: Change
  readonly driveId: string
  readonly folderId: string
  readonly itemTypes: ReadonlySet<ItemType>
  readonly maxFilesPerPoll: number
  readonly mimeTypes: readonly string[]
  readonly namePrefix: string
}

interface Checkpoint {
  readonly boundaryKeys?: readonly string[]
  readonly changeType?: string
  readonly floor?: string
  readonly maxSeen?: string
  readonly pageQuery?: string
  readonly pageToken?: string
  readonly since: string
}

interface File {
  readonly createdTime?: string
  readonly driveId?: string
  readonly id?: string
  readonly lastModifyingUser?: { readonly displayName?: string; readonly emailAddress?: string }
  readonly mimeType?: string
  readonly modifiedTime?: string
  readonly name?: string
  readonly parents?: readonly string[]
  readonly size?: string
  readonly webViewLink?: string
}

interface Page {
  readonly files?: readonly File[]
  readonly incompleteSearch?: boolean
  readonly nextPageToken?: string
}

const folderMimeType = 'application/vnd.google-apps.folder'
const listFields =
  'nextPageToken,incompleteSearch,files(id,name,mimeType,createdTime,modifiedTime,parents,trashed,webViewLink,driveId,size,version,lastModifyingUser(displayName,emailAddress))'
const transientReasons = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded', 'sharingRateLimitExceeded'])
const permanentReasons = new Set(['insufficientFilePermissions', 'appNotAuthorizedToFile'])

const eventSchema = {
  additionalProperties: false,
  properties: {
    createdTime: { type: ['string', 'null'] },
    driveId: { type: ['string', 'null'] },
    eventType: { enum: ['file_created', 'file_updated', 'folder_created', 'folder_updated'], type: 'string' },
    fileId: { type: 'string' },
    itemType: { enum: ['file', 'folder'], type: 'string' },
    lastModifyingUser: { type: ['object', 'null'] },
    mimeType: { type: 'string' },
    modifiedTime: { type: ['string', 'null'] },
    name: { type: 'string' },
    parents: { items: { type: 'string' }, type: 'array' },
    size: { type: 'string' },
    webViewLink: { type: ['string', 'null'] },
  },
  required: ['eventType', 'itemType', 'fileId', 'name', 'mimeType', 'createdTime', 'modifiedTime', 'parents', 'webViewLink', 'driveId', 'lastModifyingUser'],
  type: 'object',
} as const

const snapshot = {
  configSchema: {
    additionalProperties: false,
    properties: {
      changeType: { enum: ['created', 'updated'], type: 'string' },
      driveId: { default: '', pattern: '^[A-Za-z0-9_-]{0,512}$', type: 'string' },
      folderId: { pattern: '^[A-Za-z0-9_-]{2,512}$', type: 'string' },
      itemTypes: {
        default: ['file'],
        items: { enum: ['file', 'folder'], type: 'string' },
        minItems: 1,
        type: 'array',
        uniqueItems: true,
      },
      maxFilesPerPoll: { default: 50, maximum: 200, minimum: 1, type: 'integer' },
      mimeTypes: { default: [], items: { minLength: 1, type: 'string' }, type: 'array' },
      namePrefix: { default: '', type: 'string' },
    },
    required: ['folderId', 'changeType'],
    title: 'Google Drive Folder Change Config',
    type: 'object',
  },
  definitionVersion: 1,
  description: 'Polls one Google Drive folder and triggers when a file or folder directly inside it is created or updated.',
  displayName: 'File or Folder Change in a Folder',
  key: 'googledrive.on_file_change',
  name: 'on_file_change',
  payloadSchema: {
    additionalProperties: false,
    properties: { events: { items: eventSchema, type: 'array' } },
    required: ['events'],
    title: 'Google Drive File Change Payload',
    type: 'object',
  },
  provider: 'googledrive',
  type: 'poll',
} as const satisfies TriggerKeySnapshot & { readonly type: 'poll' }

export const googleDriveFileChange: PollDefinition = {
  snapshot,
  async poll(context) {
    const config = resolveConfig(context.config)
    if (context.checkpoint === null) return seed(context, config)
    const checkpoint = readCheckpoint(context.checkpoint)
    if (checkpoint.changeType !== config.changeType) {
      return { checkpoint: seeded(context.now, config.changeType) as unknown as JsonValue, events: [] }
    }
    return pollFolder(context, config, checkpoint)
  },
}

function resolveConfig(value: Readonly<Record<string, JsonValue>>): Config {
  return {
    changeType: value.changeType as Change,
    driveId: (value.driveId as string | undefined) ?? '',
    folderId: value.folderId as string,
    itemTypes: new Set((value.itemTypes as readonly ItemType[] | undefined) ?? ['file']),
    maxFilesPerPoll: (value.maxFilesPerPoll as number | undefined) ?? 50,
    mimeTypes: (value.mimeTypes as readonly string[] | undefined) ?? [],
    namePrefix: (value.namePrefix as string | undefined) ?? '',
  }
}

function readCheckpoint(value: JsonValue): Checkpoint {
  const checkpoint = record(value)
  if (typeof checkpoint?.since != 'string' || Number.isNaN(Date.parse(checkpoint.since))) {
    throw new PermanentPollError('Google Drive checkpoint is invalid; recreate the Trigger.')
  }
  const boundary = checkpoint.boundaryKeys
  return {
    since: checkpoint.since,
    ...(typeof checkpoint.floor == 'string' ? { floor: checkpoint.floor } : {}),
    ...(typeof checkpoint.pageToken == 'string' ? { pageToken: checkpoint.pageToken } : {}),
    ...(typeof checkpoint.pageQuery == 'string' ? { pageQuery: checkpoint.pageQuery } : {}),
    ...(typeof checkpoint.changeType == 'string' ? { changeType: checkpoint.changeType } : {}),
    ...(typeof checkpoint.maxSeen == 'string' ? { maxSeen: checkpoint.maxSeen } : {}),
    ...(Array.isArray(boundary) ? { boundaryKeys: boundary.filter((key): key is string => typeof key == 'string') } : {}),
  }
}

async function seed(context: PollContext, config: Config): Promise<PollResult> {
  const result = await get(context, `/drive/v3/files/${encodeURIComponent(config.folderId)}`, {
    fields: 'id,name,mimeType,driveId,trashed',
    supportsAllDrives: 'true',
  })
  success(result, 'folder probe')
  const probe = record(result.data)
  if (probe == null) throw new TransientPollError('Google Drive folder probe returned no payload.')
  if (probe.mimeType !== folderMimeType) throw new PermanentPollError('Google Drive folderId does not point to a folder.')
  if (probe.trashed === true) throw new PermanentPollError('The Google Drive folder is in the trash.')
  if (config.driveId.length > 0 && (probe.driveId ?? '') !== config.driveId) {
    throw new PermanentPollError('The configured Google Drive shared drive does not contain this folder.')
  }
  return { checkpoint: seeded(context.now, config.changeType) as unknown as JsonValue, events: [] }
}

function seeded(now: Date, change: Change): Checkpoint {
  const since = now.toISOString()
  return { changeType: change, floor: since, since }
}

async function pollFolder(context: PollContext, config: Config, checkpoint: Checkpoint): Promise<PollResult> {
  const query = filesQuery(config, checkpoint.since, checkpoint.floor)
  const fingerprint = `${config.driveId}|${query}`
  const pageToken = checkpoint.pageQuery == fingerprint ? checkpoint.pageToken : undefined
  const result = await get(context, '/drive/v3/files', {
    corpora: config.driveId.length == 0 ? 'allDrives' : 'drive',
    driveId: config.driveId.length == 0 ? undefined : config.driveId,
    fields: listFields,
    includeItemsFromAllDrives: 'true',
    pageSize: config.maxFilesPerPoll,
    pageToken,
    q: query,
    spaces: 'drive',
    supportsAllDrives: 'true',
  })
  success(result, 'files list')
  const page = (record(result.data) ?? {}) as Page
  const delivered = new Set(checkpoint.boundaryKeys ?? [])
  const events: PollEvent[] = []
  const consumed: string[] = []
  let maxSeen = pageToken == null ? undefined : checkpoint.maxSeen
  for (const file of page.files ?? []) {
    if (file.id == null || file.id.length == 0) continue
    const timestamp = trackedTime(file, config.changeType)
    if (timestamp == null) continue
    const value = event(file, file.id, timestamp, config.changeType)
    consumed.push(value.dedupeKey)
    if (later(timestamp, maxSeen)) maxSeen = timestamp
    if (!delivered.has(value.dedupeKey)) events.push(value)
  }

  if (page.incompleteSearch === true) {
    const drain = pageToken == null ? {} : pageState(pageToken, fingerprint, maxSeen)
    return {
      checkpoint: checkpointValue(checkpoint, config.changeType, checkpoint.since, consumed, drain) as unknown as JsonValue,
      events,
    }
  }
  if (page.nextPageToken) {
    return {
      checkpoint: checkpointValue(
        checkpoint,
        config.changeType,
        checkpoint.since,
        consumed,
        pageState(page.nextPageToken, fingerprint, maxSeen),
      ) as unknown as JsonValue,
      events,
      hasMore: true,
    }
  }
  const since = maxSeen ?? checkpoint.since
  return { checkpoint: checkpointValue(checkpoint, config.changeType, since, consumed) as unknown as JsonValue, events }
}

function pageState(
  pageToken: string,
  pageQuery: string,
  maxSeen: string | undefined,
): { readonly maxSeen?: string; readonly pageQuery: string; readonly pageToken: string } {
  return { pageQuery, pageToken, ...(maxSeen == null ? {} : { maxSeen }) }
}

function checkpointValue(
  previous: Checkpoint,
  change: Change,
  since: string,
  consumed: readonly string[],
  page: { readonly maxSeen?: string; readonly pageQuery?: string; readonly pageToken?: string } = {},
): Checkpoint {
  const boundaryKeys = [...new Set([...(previous.boundaryKeys ?? []), ...consumed])]
    .map((key) => ({ at: Date.parse(key.slice(key.indexOf(':') + 1)), key }))
    .filter(({ at }) => at >= windowStart(since, previous.floor))
    .toSorted((left, right) => right.at - left.at)
    .slice(0, 200)
    .map(({ key }) => key)
  return {
    changeType: change,
    since,
    ...floorField(previous.floor, since),
    ...page,
    ...(boundaryKeys.length == 0 ? {} : { boundaryKeys }),
  }
}

function filesQuery(config: Config, since: string, floorValue: string | undefined): string {
  const field = config.changeType == 'created' ? 'createdTime' : 'modifiedTime'
  const terms = [`'${escape(config.folderId)}' in parents`, 'trashed = false', `${field} >= '${new Date(windowStart(since, floorValue)).toISOString()}'`]
  if (!config.itemTypes.has('folder')) terms.push(`mimeType != '${folderMimeType}'`)
  else if (!config.itemTypes.has('file')) terms.push(`mimeType = '${folderMimeType}'`)
  if (config.mimeTypes.length > 0) terms.push(`(${config.mimeTypes.map((type) => `mimeType = '${escape(type)}'`).join(' or ')})`)
  if (config.namePrefix.length > 0) terms.push(`name contains '${escape(config.namePrefix)}'`)
  return terms.join(' and ')
}

function windowStart(since: string, floorValue: string | undefined): number {
  const start = Date.parse(since) - 60_000
  const minimum = floorValue == null ? Number.NaN : Date.parse(floorValue)
  return Number.isNaN(minimum) ? start : Math.max(start, minimum)
}

function floorField(value: string | undefined, since: string): { readonly floor?: string } {
  if (value == null || Number.isNaN(Date.parse(value)) || Date.parse(since) - 60_000 >= Date.parse(value)) return {}
  return { floor: value }
}

function trackedTime(file: File, change: Change): string | undefined {
  const value = change == 'created' ? file.createdTime : file.modifiedTime
  return value == null || value.length == 0 || Number.isNaN(Date.parse(value)) ? undefined : value
}

function event(file: File, id: string, timestamp: string, change: Change): PollEvent {
  const itemType: ItemType = file.mimeType == folderMimeType ? 'folder' : 'file'
  const user = file.lastModifyingUser
  return {
    dedupeKey: `${id}:${timestamp}`,
    payload: {
      createdTime: file.createdTime ?? null,
      driveId: file.driveId ?? null,
      eventType: `${itemType}_${change}`,
      fileId: id,
      itemType,
      lastModifyingUser: user == null ? null : { displayName: user.displayName ?? '', emailAddress: user.emailAddress ?? '' },
      mimeType: file.mimeType ?? '',
      modifiedTime: file.modifiedTime ?? null,
      name: file.name ?? '',
      parents: file.parents ?? [],
      ...(file.size == null ? {} : { size: file.size }),
      webViewLink: file.webViewLink ?? null,
    },
  }
}

async function get(context: PollContext, endpoint: string, query: Readonly<Record<string, number | string | undefined>>): Promise<ConnectorProxyResult> {
  try {
    return await context.connector.execute(
      {
        endpoint,
        method: 'GET',
        query: Object.fromEntries(Object.entries(query).filter((entry): entry is [string, number | string] => entry[1] != null)),
      },
      context.signal,
    )
  } catch (cause) {
    throw new TransientPollError(`Google Drive proxy request to ${endpoint} failed.`, { cause })
  }
}

function success(result: ConnectorProxyResult, operation: string): void {
  if (result.status >= 200 && result.status < 300) return
  if (result.status == 400 || result.status == 404) throw new PermanentPollError(`Google Drive ${operation} rejected the configuration.`)
  if (result.status == 401) throw new PollConnectionError(`Google Drive ${operation} rejected the Connection.`)
  if (result.status == 403) {
    const values = reasons(result.data)
    if (values.some((reason) => transientReasons.has(reason))) throw new TransientPollError(`Google Drive ${operation} was rate limited.`)
    if (values.some((reason) => permanentReasons.has(reason))) throw new PermanentPollError(`Google Drive ${operation} was rejected by an ACL.`)
    if (insufficientScopes(result.data)) throw new PollConnectionError(`Google Drive ${operation} needs additional scopes.`)
  }
  throw new TransientPollError(`Google Drive ${operation} failed with status ${result.status}.`)
}

function reasons(data: unknown): readonly string[] {
  const error = record(record(data)?.error)
  const nested = [error?.errors, error?.details].flatMap((value) => (Array.isArray(value) ? value : []))
  return [...nested.map((value) => record(value)?.reason), error?.status].filter((value): value is string => typeof value == 'string')
}

function insufficientScopes(data: unknown): boolean {
  if (reasons(data).includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT')) return true
  const message = record(record(data)?.error)?.message
  return typeof message == 'string' && message.toLowerCase().includes('insufficient authentication scopes')
}

function escape(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")
}

function later(candidate: string, current: string | undefined): boolean {
  const candidateMs = Date.parse(candidate)
  if (Number.isNaN(candidateMs)) return false
  return current == null || Number.isNaN(Date.parse(current)) || candidateMs > Date.parse(current)
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value == 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}
