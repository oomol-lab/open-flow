import type { ConnectorProxy } from '../../connector/common/proxy.ts'
import type { JsonValue, TriggerKeySnapshot, TriggerSchedule } from '../../flow/common/change.ts'
import type { TriggerConfigOption, TriggerConfigOptionsContext } from './configOptions.ts'

const encoder = new TextEncoder()

export const maximumPollCheckpointBytes = 64 * 1024
export const maximumPollDedupeKeyBytes = 1024
export const maximumPollEventsPerPage = 100

export interface PollEvent {
  readonly dedupeKey: string
  readonly payload: Readonly<Record<string, JsonValue>>
}

export interface PollResult {
  readonly checkpoint: JsonValue
  readonly events: readonly PollEvent[]
  readonly filtered?: number
  readonly hasMore?: boolean
}

export interface PollContext {
  readonly checkpoint: JsonValue
  readonly config: Readonly<Record<string, JsonValue>>
  readonly connector: ConnectorProxy
  readonly now: Date
  readonly signal?: AbortSignal
}

export interface PollDefinition {
  readonly configOptions?: (context: TriggerConfigOptionsContext) => Promise<readonly TriggerConfigOption[]>
  readonly poll: (context: PollContext) => Promise<PollResult>
  readonly snapshot: TriggerKeySnapshot & { readonly type: 'poll' }
}

export class PollConnectionError extends Error {
  override readonly name = 'PollConnectionError'
}

export class PermanentPollError extends Error {
  override readonly name = 'PermanentPollError'
}

export class TransientPollError extends Error {
  override readonly name = 'TransientPollError'
}

export async function pollPageClaimId(bindingId: string, runtimeVersion: number, rootOccurrenceId: string, page: number): Promise<string> {
  if (!Number.isSafeInteger(page) || page <= 0) throw new RangeError('Poll continuation page must be a positive integer.')
  return await digest(`${bindingId}\0${runtimeVersion}\0${rootOccurrenceId}\0${page}`)
}

export async function providerEventId(bindingId: string, triggerKey: string, dedupeKey: string): Promise<string> {
  if (encoder.encode(dedupeKey).byteLength > maximumPollDedupeKeyBytes) throw new RangeError('Poll event dedupe key exceeds 1024 bytes.')
  return await digest(`${bindingId}\0${triggerKey}\0${dedupeKey}`)
}

export interface PollConformanceFixture {
  readonly config: Readonly<Record<string, JsonValue>>
  readonly connectionId: string
  readonly publishedAt: string
  readonly rules: readonly TriggerSchedule[]
}

export interface PollConformanceState {
  readonly calls: number
  readonly checkpoint: JsonValue
  readonly health: 'healthy' | 'initializing'
  readonly payloads: readonly JsonValue[]
}

export interface PollConformanceHarness {
  dispose(): Promise<void>
  replayLast(): Promise<void>
  republish(at: string, change?: { readonly config?: Readonly<Record<string, JsonValue>>; readonly connectionId?: string }): Promise<void>
  restart(): Promise<void>
  retire(at: string): Promise<void>
  state(): Promise<PollConformanceState>
  tick(at: string, pages: readonly PollResult[]): Promise<void>
}

export interface PollConformanceCase {
  readonly fixture: PollConformanceFixture
  readonly name: string
  verify(harness: PollConformanceHarness): Promise<void>
}

const minutely: readonly TriggerSchedule[] = [{ type: 'every', unit: 'minute', value: 1 }]
const fixture: PollConformanceFixture = {
  config: { source: 'primary' },
  connectionId: 'connection-primary',
  publishedAt: '2026-08-21T00:00:30.000Z',
  rules: minutely,
}

export const pollConformanceCases: readonly PollConformanceCase[] = [
  {
    fixture,
    name: 'baselines every continuation page before becoming healthy',
    async verify(harness) {
      await harness.tick('2026-08-21T00:01:00.000Z', [
        { checkpoint: { cursor: 'baseline-1' }, events: [{ dedupeKey: 'old-1', payload: { value: 'old-1' } }], hasMore: true },
        { checkpoint: { cursor: 'baseline-2' }, events: [{ dedupeKey: 'old-2', payload: { value: 'old-2' } }] },
      ])
      equal(await harness.state(), { calls: 2, checkpoint: { cursor: 'baseline-2' }, health: 'healthy', payloads: [] }, 'Baseline state')
    },
  },
  {
    fixture,
    name: 'batches fresh page events and suppresses duplicate identities',
    async verify(harness) {
      await harness.tick('2026-08-21T00:01:00.000Z', [{ checkpoint: { cursor: 'baseline' }, events: [] }])
      const event = { dedupeKey: 'event-1', payload: { value: 'first' } } as const
      await harness.tick('2026-08-21T00:02:00.000Z', [
        { checkpoint: { cursor: 'next' }, events: [event, event, { dedupeKey: 'event-2', payload: { value: 'second' } }] },
      ])
      await harness.tick('2026-08-21T00:03:00.000Z', [{ checkpoint: { cursor: 'last' }, events: [event] }])
      equal(
        await harness.state(),
        {
          calls: 3,
          checkpoint: { cursor: 'last' },
          health: 'healthy',
          payloads: [{ events: [{ value: 'first' }, { value: 'second' }] }],
        },
        'Deduplicated state',
      )
    },
  },
  {
    fixture,
    name: 'replays a completed root across restart without polling again',
    async verify(harness) {
      await harness.tick('2026-08-21T00:01:00.000Z', [{ checkpoint: { cursor: 'baseline' }, events: [] }])
      await harness.tick('2026-08-21T00:02:00.000Z', [{ checkpoint: { cursor: 'event' }, events: [{ dedupeKey: 'event-1', payload: { value: 'first' } }] }])
      await harness.restart()
      await harness.replayLast()
      equal(
        await harness.state(),
        {
          calls: 2,
          checkpoint: { cursor: 'event' },
          health: 'healthy',
          payloads: [{ events: [{ value: 'first' }] }],
        },
        'Replayed state',
      )
    },
  },
  {
    fixture,
    name: 'preserves an unchanged checkpoint and baselines changed semantics',
    async verify(harness) {
      await harness.tick('2026-08-21T00:01:00.000Z', [{ checkpoint: { cursor: 'baseline' }, events: [] }])
      await harness.republish('2026-08-21T00:01:30.000Z')
      equal(await harness.state(), { calls: 1, checkpoint: { cursor: 'baseline' }, health: 'healthy', payloads: [] }, 'Unchanged publication state')
      await harness.republish('2026-08-21T00:01:40.000Z', { config: { source: 'secondary' } })
      await harness.tick('2026-08-21T00:02:00.000Z', [
        { checkpoint: { cursor: 'secondary-baseline' }, events: [{ dedupeKey: 'old-secondary', payload: { value: 'old' } }] },
      ])
      equal(await harness.state(), { calls: 2, checkpoint: { cursor: 'secondary-baseline' }, health: 'healthy', payloads: [] }, 'Changed publication state')
      await harness.retire('2026-08-21T00:02:30.000Z')
      await harness.tick('2026-08-21T00:03:00.000Z', [{ checkpoint: { cursor: 'retired' }, events: [] }])
      equal(await harness.state(), { calls: 2, checkpoint: { cursor: 'secondary-baseline' }, health: 'healthy', payloads: [] }, 'Retired state')
    },
  },
]

async function digest(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
  return `sha256:${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function equal(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) != JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`)
  }
}
