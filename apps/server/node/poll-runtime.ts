import type { JsonValue, RevisionContent, TriggerNode } from '@oomol-lab/open-flow/flow-change'
import type { PreparedFlow } from '@oomol-lab/open-flow/flow-semantics'
import type { PollDefinition } from '@oomol-lab/open-flow/poll-trigger'
import type { Logger } from 'pino'
import type { ConnectorHost } from './connector.ts'
import type { PollCandidate } from './poll-store.ts'
import type { Store } from './store.ts'
import type { PollState, StoredPollTarget } from './trigger-store.ts'

import { controlErrorCode } from '@oomol-lab/open-flow/control-api'
import { scheduledTriggerOccurrenceId, nextTriggerScheduledAt } from '@oomol-lab/open-flow/cron-trigger'
import { canonicalJsonBytes, digestBytes } from '@oomol-lab/open-flow/flow-encoding'
import {
  maximumPollCheckpointBytes,
  maximumPollEventsPerPage,
  PermanentPollError,
  pollPageClaimId,
  providerEventId,
  PollConnectionError,
  TransientPollError,
} from '@oomol-lab/open-flow/poll-trigger'
import * as Clock from 'effect/Clock'
import * as Effect from 'effect/Effect'
import * as Semaphore from 'effect/Semaphore'
import { ConnectorTaskError } from './connector.ts'
import { ControlError, serverErrorCode } from './error.ts'
import { errorKind } from './logger.ts'

const encoder = new TextEncoder()
const batchSize = 100
const claimRetentionMs = 30 * 24 * 60 * 60 * 1000
const leaseMs = 60_000
const retryMs = 1_000
const timeoutMs = 30_000
const admissionRetryMs = 1_000

export class PollRuntime {
  readonly #clock: () => number
  readonly #clockService: Clock.Clock
  readonly #definitions: ReadonlyMap<string, PollDefinition>
  readonly #lock: Semaphore.Semaphore
  readonly #logger: Logger
  readonly #resolveConnector: () => ConnectorHost | undefined
  readonly #runCreated: (flowId: string, runId: string) => void
  readonly #signal: () => void
  readonly #store: Store
  readonly #validatedFlow: (revision: RevisionContent) => Promise<{
    readonly content: string
    readonly prepared: PreparedFlow
    readonly revisionDigest: string
    readonly variableBindings: Readonly<Record<string, string>>
  }>

  constructor(
    store: Store,
    resolveConnector: () => ConnectorHost | undefined,
    clock: () => number,
    clockService: Clock.Clock,
    lock: Semaphore.Semaphore,
    definitions: readonly PollDefinition[],
    validatedFlow: (revision: RevisionContent) => Promise<{
      readonly content: string
      readonly prepared: PreparedFlow
      readonly revisionDigest: string
      readonly variableBindings: Readonly<Record<string, string>>
    }>,
    signal: () => void,
    runCreated: (flowId: string, runId: string) => void,
    logger: Logger,
  ) {
    this.#clock = clock
    this.#clockService = clockService
    this.#definitions = new Map(definitions.map((definition) => [definition.snapshot.key, definition]))
    this.#lock = lock
    this.#logger = logger.child({ component: 'poll' })
    this.#resolveConnector = resolveConnector
    this.#runCreated = runCreated
    this.#signal = signal
    this.#store = store
    this.#validatedFlow = validatedFlow
  }

  async test(
    flowId: string,
    triggerNodeId: string,
  ): Promise<{
    readonly events: readonly Readonly<Record<string, JsonValue>>[]
    readonly filtered: number
    readonly hasMore: boolean
    readonly version: 1
  }> {
    const target = this.#store.polls.pollTestTarget(flowId, triggerNodeId)
    if (target == null) throw new ControlError(controlErrorCode.triggerNotFound, 'The Trigger binding was not found.')
    try {
      const revision = JSON.parse(target.content) as RevisionContent
      const fixed = await this.#validatedFlow(revision)
      const trigger = fixed.prepared.graph.nodes[target.triggerNodeId]
      if (
        fixed.revisionDigest != target.revisionDigest ||
        fixed.prepared.closureDigest != target.closureDigest ||
        trigger?.kind != 'poll' ||
        JSON.stringify(trigger) != target.triggerJson
      ) {
        throw new PermanentPollError('Fixed Poll Trigger target does not match its Publication.')
      }
      const definition = this.#definitions.get(trigger.definition.key)
      if (definition?.snapshot.definitionVersion != trigger.definition.definitionVersion) {
        throw new PermanentPollError('Fixed Poll Trigger definition is not available.')
      }
      const connection = revision.document.bindings[trigger.bindingId]
      if (connection?.kind != 'connection' || connection.target != target.connectionId) {
        throw new ControlError(controlErrorCode.bindingUnresolved, 'The fixed Poll Trigger Connection is unresolved.')
      }
      const connector = this.#resolveConnector()
      if (connector == null) throw new ControlError(controlErrorCode.connectorUnavailable, 'The Connector request could not be completed.')
      const result = await Effect.runPromise(
        Effect.tryPromise({
          try: (signal) =>
            definition.poll({
              checkpoint: target.checkpoint,
              config: trigger.config,
              connector: {
                execute: (request, requestSignal) =>
                  connector.proxy(
                    definition.snapshot.provider,
                    target.connectionId,
                    target.bindingId,
                    request,
                    requestSignal == null ? signal : AbortSignal.any([signal, requestSignal]),
                    this.#store.connectorTeam(flowId),
                  ),
              },
              now: new Date(this.#clock()),
              signal,
            }),
          catch: (error) => error,
        }).pipe(
          Effect.timeoutOrElse({
            duration: timeoutMs,
            orElse: () => Effect.fail(new TransientPollError('Poll Provider exceeded its execution deadline.')),
          }),
          Effect.provideService(Clock.Clock, this.#clockService),
        ),
      )
      if (result.events.length > maximumPollEventsPerPage) {
        throw new PermanentPollError(`Poll page exceeds ${maximumPollEventsPerPage} events.`)
      }
      return {
        events: result.events.map((event) => event.payload),
        filtered: result.filtered ?? 0,
        hasMore: result.hasMore == true,
        version: 1,
      }
    } catch (error) {
      if (error instanceof ControlError) throw error
      if (error instanceof PollConnectionError || (error instanceof ConnectorTaskError && error.code == 'connector.connection-required')) {
        throw new ControlError(serverErrorCode.connectorConnectionRequired, 'The Poll Trigger Connection requires reauthorization.')
      }
      if (error instanceof PermanentPollError) throw new ControlError(controlErrorCode.triggerKeyInvalid, error.message)
      throw new ControlError(controlErrorCode.connectorUnavailable, 'The Connector request could not be completed.')
    }
  }

  tick(at: string): Effect.Effect<void, unknown> {
    return this.#lock.withPermit(
      Effect.gen({ self: this }, function* () {
        const now = Date.parse(at)
        if (!Number.isFinite(now)) return yield* Effect.fail(new TypeError('Poll tick time must be an ISO timestamp.'))
        while (true) {
          const candidates = this.#store.polls.dueCandidates(now, batchSize)
          if (candidates.length == 0) break
          for (const candidate of candidates) yield* this.#baseline(candidate, now)
        }
        let pages = 0
        while (pages < batchSize) {
          const targets = this.#store.polls.duePoll(now, batchSize - pages)
          if (targets.length == 0) break
          pages += targets.length
          for (const target of targets) {
            const scheduledAt = new Date(target.nextAt).toISOString()
            const occurrenceId = yield* Effect.tryPromise({
              try: () => scheduledTriggerOccurrenceId(target.bindingId, target.runtimeVersion, scheduledAt),
              catch: (error) => error,
            })
            yield* this.#poll(target, occurrenceId, now)
          }
        }
        this.#signal()
      }),
    )
  }

  process(input: { readonly bindingId: string; readonly occurredAt: string; readonly occurrenceId: string; readonly runtimeVersion: number }): Promise<void> {
    return Effect.runPromise(
      this.#lock
        .withPermit(
          Effect.gen({ self: this }, function* () {
            const now = Date.parse(input.occurredAt)
            if (!Number.isFinite(now)) return yield* Effect.fail(new TypeError('Poll occurrence time must be an ISO timestamp.'))
            const target = this.#store.polls.pollTarget(input.bindingId, input.runtimeVersion)
            if (target != null) yield* this.#poll(target, input.occurrenceId, now)
            this.#signal()
          }),
        )
        .pipe(Effect.provideService(Clock.Clock, this.#clockService)),
    )
  }

  state(flowId: string, triggerNodeId: string): PollState | undefined {
    return this.#store.polls.pollState(flowId, triggerNodeId)
  }

  supports(key: string, definitionVersion: number): boolean {
    return this.#definitions.get(key)?.snapshot.definitionVersion == definitionVersion
  }

  #baseline(candidate: PollCandidate, now: number): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const trigger = JSON.parse(candidate.triggerJson) as TriggerNode
      if (trigger.kind != 'poll' || JSON.stringify(trigger.pollTimes) != candidate.scheduleJson) {
        return yield* Effect.fail(new PermanentPollError('Fixed Poll candidate is invalid.'))
      }
      const definition = this.#definitions.get(trigger.definition.key)
      if (definition?.snapshot.definitionVersion != trigger.definition.definitionVersion) {
        return yield* Effect.fail(new PermanentPollError('Fixed Poll Trigger definition is not available.'))
      }
      const connector = this.#resolveConnector()
      if (connector == null) {
        return yield* Effect.fail(new ConnectorTaskError('connector.unavailable', 'The Connector request could not be completed.'))
      }
      const result = yield* Effect.tryPromise({
        try: (signal) =>
          definition.poll({
            checkpoint: JSON.parse(candidate.checkpointJson) as JsonValue,
            config: trigger.config,
            connector: {
              execute: (request, requestSignal) =>
                connector.proxy(
                  definition.snapshot.provider,
                  candidate.connectionId,
                  candidate.bindingId,
                  request,
                  requestSignal == null ? signal : AbortSignal.any([signal, requestSignal]),
                  this.#store.connectorTeam(candidate.flowId),
                ),
            },
            now: new Date(now),
            signal,
          }),
        catch: (error) => error,
      }).pipe(
        Effect.timeoutOrElse({
          duration: timeoutMs,
          orElse: () => Effect.fail(new TransientPollError('Poll Provider exceeded its execution deadline.')),
        }),
      )
      if (result.events.length > maximumPollEventsPerPage) {
        return yield* Effect.fail(new PermanentPollError(`Poll page exceeds ${maximumPollEventsPerPage} events.`))
      }
      const checkpointJson = JSON.stringify(result.checkpoint)
      if (checkpointJson == null || encoder.encode(checkpointJson).byteLength > maximumPollCheckpointBytes) {
        return yield* Effect.fail(new PermanentPollError('Poll checkpoint exceeds 64 KiB.'))
      }
      if (!this.#store.polls.completeCandidate(candidate, checkpointJson, result.hasMore == true, now)) {
        return yield* Effect.fail(new TransientPollError('Poll candidate changed before its baseline was saved.'))
      }
      if (result.hasMore != true) {
        this.#logger.info(
          { category: 'publication.poll_ready', nodeId: candidate.nodeId, operationId: candidate.operationId },
          'Poll candidate baseline is ready.',
        )
      }
      this.#signal()
    }).pipe(
      Effect.matchEffect({
        onFailure: (error) =>
          Effect.sync(() => {
            const health = failure(error)
            if (health != null) {
              this.#store.polls.failCandidate(
                candidate,
                health == 'needs_reauth' ? 'connector.connection-required' : 'trigger-key.invalid',
                health == 'needs_reauth' ? 'The Poll Trigger Connection requires reauthorization.' : 'The Poll Trigger baseline could not be prepared.',
                now,
              )
              this.#logger.warn(
                { category: 'publication.poll_failed', nodeId: candidate.nodeId, operationId: candidate.operationId, ...errorKind(error) },
                'Poll candidate baseline failed.',
              )
              return
            }
            this.#store.polls.retryCandidate(candidate, now + retryMs, now)
            this.#logger.warn(
              {
                category: 'publication.poll_retrying',
                nodeId: candidate.nodeId,
                operationId: candidate.operationId,
                retryAt: now + retryMs,
                ...errorKind(error),
              },
              'Poll candidate baseline will be retried.',
            )
          }),
        onSuccess: () => Effect.void,
      }),
    )
  }

  #poll(target: StoredPollTarget, occurrenceId: string, now: number): Effect.Effect<void, unknown> {
    return Effect.gen({ self: this }, function* () {
      const rootOccurrenceId = target.continuationRootId ?? occurrenceId
      const page = target.continuationRootId == null ? 0 : target.continuationPage
      const claimId =
        page == 0
          ? rootOccurrenceId
          : yield* Effect.tryPromise({
              try: () => pollPageClaimId(target.bindingId, target.runtimeVersion, rootOccurrenceId, page),
              catch: (error) => error,
            })
      const claim = this.#store.polls.claimPoll(target, claimId, now, now + leaseMs)
      if (claim.kind != 'acquired') {
        if (claim.kind == 'completed') this.#signal()
        return
      }

      yield* Effect.gen({ self: this }, function* () {
        const revision = JSON.parse(target.content) as RevisionContent
        const fixed = yield* Effect.tryPromise({ try: () => this.#validatedFlow(revision), catch: (error) => error })
        const trigger = fixed.prepared.graph.nodes[target.triggerNodeId]
        if (
          fixed.revisionDigest != target.revisionDigest ||
          fixed.prepared.closureDigest != target.closureDigest ||
          trigger?.kind != 'poll' ||
          JSON.stringify(trigger) != target.triggerJson ||
          JSON.stringify(trigger.pollTimes) != target.scheduleJson
        ) {
          return yield* Effect.fail(new PermanentPollError('Fixed Poll Trigger target does not match its Publication.'))
        }
        const definition = this.#definitions.get(trigger.definition.key)
        if (definition?.snapshot.definitionVersion != trigger.definition.definitionVersion) {
          return yield* Effect.fail(new PermanentPollError('Fixed Poll Trigger definition is not available.'))
        }
        const connection = revision.document.bindings[trigger.bindingId]
        if (connection?.kind != 'connection' || connection.target != target.connectionId) {
          return yield* Effect.fail(new PermanentPollError('Fixed Poll Trigger Connection does not match its Publication.'))
        }
        const connector = this.#resolveConnector()
        if (connector == null) {
          return yield* Effect.fail(new ConnectorTaskError('connector.unavailable', 'The Connector request could not be completed.'))
        }
        const result = yield* Effect.tryPromise({
          try: (signal) =>
            definition.poll({
              checkpoint: target.checkpoint,
              config: trigger.config,
              connector: {
                execute: (request, requestSignal) =>
                  connector.proxy(
                    definition.snapshot.provider,
                    target.connectionId,
                    target.bindingId,
                    request,
                    requestSignal == null ? signal : AbortSignal.any([signal, requestSignal]),
                    this.#store.connectorTeam(target.flowId),
                  ),
              },
              now: new Date(now),
              signal,
            }),
          catch: (error) => error,
        }).pipe(
          Effect.timeoutOrElse({
            duration: timeoutMs,
            orElse: () => Effect.fail(new TransientPollError('Poll Provider exceeded its execution deadline.')),
          }),
        )
        if (result.events.length > maximumPollEventsPerPage) {
          return yield* Effect.fail(new PermanentPollError(`Poll page exceeds ${maximumPollEventsPerPage} events.`))
        }
        const checkpointJson = JSON.stringify(result.checkpoint)
        if (checkpointJson == null || encoder.encode(checkpointJson).byteLength > maximumPollCheckpointBytes) {
          return yield* Effect.fail(new PermanentPollError('Poll checkpoint exceeds 64 KiB.'))
        }
        const baseline = target.health == 'initializing'
        const identified = yield* Effect.forEach(
          result.events,
          (event) =>
            Effect.tryPromise({
              try: () => providerEventId(target.bindingId, definition.snapshot.key, event.dedupeKey),
              catch: (error) => error,
            }).pipe(Effect.map((id) => ({ event, id }))),
          { concurrency: 'unbounded' },
        )
        const known = baseline
          ? new Set<string>()
          : this.#store.polls.knownPollEvents(
              target.bindingId,
              identified.map((item) => item.id),
            )
        const pageIds = new Set<string>()
        const fresh = baseline
          ? []
          : identified.filter((item) => {
              if (known.has(item.id) || pageIds.has(item.id)) return false
              pageIds.add(item.id)
              return true
            })
        const payload = fresh.length == 0 ? null : ({ events: fresh.map((item) => item.event.payload) } satisfies JsonValue)
        const requestDigest =
          payload == null
            ? null
            : yield* Effect.tryPromise({
                try: () =>
                  digestBytes(
                    canonicalJsonBytes({
                      bindingId: target.bindingId,
                      claimId,
                      payload,
                      revisionDigest: target.revisionDigest,
                      runtimeVersion: target.runtimeVersion,
                    }),
                  ),
                catch: (error) => error,
              })
        const hasMore = result.hasMore == true
        const completed = this.#store.polls.completePollPage({
          activate: baseline && !hasMore,
          checkpointJson,
          claimExpiresAt: now + claimRetentionMs,
          claimId,
          completedAt: now,
          leaseToken: claim.leaseToken,
          nextAt: hasMore ? target.nextAt : nextTriggerScheduledAt(trigger.pollTimes, now),
          nextContinuationPage: hasMore ? page + 1 : 0,
          nextContinuationRootId: hasMore ? rootOccurrenceId : null,
          page,
          payload,
          providerEventIds: fresh.map((item) => item.id),
          requestDigest,
          rootOccurrenceId,
          target,
        })
        if (completed.kind == 'overloaded') {
          this.#store.polls.failPollClaim(target.bindingId, target.runtimeVersion, claim.leaseToken, { retryAt: now + admissionRetryMs })
          return
        }
        if (completed.kind == 'completed' && completed.accepted?.kind == 'accepted') {
          if (completed.accepted.created) this.#runCreated(target.flowId, completed.accepted.runId)
          this.#signal()
        }
        if (completed.kind == 'completed' && baseline && !hasMore) {
          this.#logger.info(
            {
              bindingId: target.bindingId,
              category: 'trigger.poll.ready',
              flowId: target.flowId,
              runtimeVersion: target.runtimeVersion,
              triggerNodeId: target.triggerNodeId,
            },
            'Poll Trigger is ready.',
          )
        }
        this.#store.polls.prunePoll(now, batchSize)
      }).pipe(
        Effect.matchEffect({
          onFailure: (error) =>
            Effect.sync(() => {
              const health = failure(error)
              const fields = {
                bindingId: target.bindingId,
                flowId: target.flowId,
                runtimeVersion: target.runtimeVersion,
                triggerNodeId: target.triggerNodeId,
                ...errorKind(error),
              }
              this.#store.polls.failPollClaim(
                target.bindingId,
                target.runtimeVersion,
                claim.leaseToken,
                health == null
                  ? { retryAt: now + retryMs }
                  : { errorCode: health == 'needs_reauth' ? 'connector.connection-required' : 'trigger-key.invalid', health, now },
              )
              if (health == null) {
                this.#logger.warn({ category: 'trigger.poll.retrying', retryAt: now + retryMs, ...fields }, 'Poll Trigger will be retried.')
              } else {
                this.#logger.warn({ category: 'trigger.poll.health_changed', health, ...fields }, 'Poll Trigger health changed.')
              }
            }),
          onSuccess: () => Effect.void,
        }),
      )
    })
  }
}

function failure(error: unknown): Extract<PollState['health'], 'failed' | 'needs_reauth'> | undefined {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    if (current instanceof PollConnectionError) return 'needs_reauth'
    if (current instanceof PermanentPollError) return 'failed'
    if (current instanceof ConnectorTaskError && current.code == 'connector.connection-required') return 'needs_reauth'
  }
}
