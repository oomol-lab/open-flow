import type { ConnectorAccessSnapshot, CreateEventSource, EventSource, UpdateEventSource } from '@oomol-lab/open-flow/control-api'
import type { SourceConfiguration, SourceEvent, SourceReferenceSnapshot } from '@oomol-lab/open-flow/event-source'
import type { TriggerNode } from '@oomol-lab/open-flow/flow-change'
import type { DatabaseSync } from 'node:sqlite'

import { decodeConnectorAccessSnapshot } from '@oomol-lab/open-flow/control-api'
import { controlErrorCode } from '@oomol-lab/open-flow/control-api'
import { SourceIdentityError, eventSourceDefinition, sourceReady, sourceView, sourceReferenceSchema } from '@oomol-lab/open-flow/event-source'
import { resolveTriggerConfig } from '@oomol-lab/open-flow/integration-trigger'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { z, ZodError } from 'zod'
import { ControlError } from '../error.ts'

const sourceColumns = `source_id AS sourceId, revision, name, kind, provider, external_identity AS identity,
  connection_id AS connectionId, team_id AS teamId, config_json AS configJson, secrets_json AS secretsJson,
  state_json AS stateJson, connector_json AS connectorJson, pending_json AS pendingJson, event_types_json AS eventTypesJson, enabled, last_received_at AS lastReceivedAt, updated_at AS updatedAt`

export interface StoredEventSource extends SourceConfiguration {
  readonly connector: z.infer<typeof connectorSchema> | null
  readonly pending: z.infer<typeof pendingSchema> | null
  readonly sourceId: string
  readonly revision: number
  readonly name: string
  readonly kind: string
  readonly provider: EventSource['provider']
  readonly connectionId: string
  readonly teamId: string | null
  readonly enabled: number
  readonly lastReceivedAt: number | null
  readonly updatedAt: number
}

type SourceRow = Omit<StoredEventSource, 'config' | 'secrets' | 'state' | 'eventTypes' | 'connector' | 'pending'> & {
  readonly connectorJson: string | null
  readonly pendingJson: string | null
  readonly configJson: string
  readonly secretsJson: string
  readonly stateJson: string
  readonly eventTypesJson: string
}

const connectorSchema = z.object({
  deploymentId: z.string(),
  requestKey: z.string(),
  creation: z.string(),
  reference: sourceReferenceSchema.optional(),
  revision: z.number().int().positive().optional(),
})
const pendingSchema = z.object({ action: z.enum(['create', 'update', 'delete']), fingerprint: z.string(), remoteRevision: z.number().optional() })
const storedObject = z.record(z.string(), z.json())

function stored(row: SourceRow): StoredEventSource {
  const { configJson, secretsJson, stateJson, eventTypesJson, connectorJson, pendingJson, ...common } = row
  return {
    ...common,
    connector: connectorJson == null ? null : connectorSchema.parse(JSON.parse(connectorJson)),
    pending: pendingJson == null ? null : pendingSchema.parse(JSON.parse(pendingJson)),
    config: storedObject.parse(JSON.parse(configJson)),
    secrets: storedObject.parse(JSON.parse(secretsJson)),
    state: storedObject.parse(JSON.parse(stateJson)),
    eventTypes: JSON.parse(eventTypesJson),
  }
}

export interface SourceDelivery {
  readonly sourceId: string
  readonly eventId: string
  readonly bindingId: string
  readonly endpointId: string
  readonly publicationId: string
  readonly runtimeVersion: number
  readonly payloadJson: string
}

export interface SourceSubscription {
  readonly providerAccess: ConnectorAccessSnapshot
  readonly sourceId: string
  readonly resourceKey: string
  readonly resourceJson: string
  readonly status: 'creating' | 'ready' | 'deleting' | 'uncertain'
}

export class EventSourceStore {
  readonly #database: DatabaseSync
  readonly #transaction: <Value>(operation: () => Value) => Value
  readonly #clock: () => number

  constructor(database: DatabaseSync, transaction: <Value>(operation: () => Value) => Value, clock: () => number) {
    this.#database = database
    this.#transaction = transaction
    this.#clock = clock
  }

  get(sourceId: string): StoredEventSource | undefined {
    const row = this.#database.prepare(`SELECT ${sourceColumns} FROM event_sources WHERE source_id = ?`).get(sourceId) as SourceRow | undefined
    return row == null ? undefined : this.#source(row)
  }

  #source(row: SourceRow): StoredEventSource {
    const source = stored(row)
    if (source.connector == null) throw new SourceIdentityError('Source requires a Connector reference.')
    return source
  }

  applicationSources(kind: string, appId: string): readonly StoredEventSource[] {
    const rows = this.#database
      .prepare(`SELECT ${sourceColumns} FROM event_sources WHERE kind = ? AND json_extract(config_json, '$.appId') = ?`)
      .all(kind, appId) as unknown as SourceRow[]
    return rows.map((row) => this.#source(row))
  }

  ids(teamId?: string | null): readonly string[] {
    return this.#database
      .prepare(`SELECT source_id AS sourceId FROM event_sources${teamId === undefined ? '' : ' WHERE team_id IS ?'}`)
      .all(...(teamId === undefined ? [] : [teamId]))
      .map((row) => String(row.sourceId))
  }

  list(origin: string | undefined, teamId?: string | null): readonly EventSource[] {
    const rows = this.#database
      .prepare(`SELECT ${sourceColumns} FROM event_sources${teamId === undefined ? '' : ' WHERE team_id IS ?'} ORDER BY name, source_id`)
      .all(...(teamId === undefined ? [] : [teamId])) as unknown as SourceRow[]
    const result: EventSource[] = []
    for (const row of rows) {
      try {
        result.push(this.view(this.#source(row), origin))
      } catch (error) {
        if (!(error instanceof SourceIdentityError || error instanceof ZodError || error instanceof SyntaxError)) throw error
        result.push({
          ...this.view({ ...row, connector: null, pending: null, config: {}, secrets: {}, state: {}, eventTypes: [] }, undefined),
          lastError: 'Stored source details are invalid or unsupported. Repair or recreate this event source.',
        })
      }
    }
    return result
  }

  view(row: StoredEventSource, origin: string | undefined): EventSource {
    return {
      version: 1,
      sourceId: row.sourceId,
      revision: row.revision,
      name: row.name,
      provider: row.provider,
      connectionId: row.connectionId,
      teamId: row.teamId,
      enabled: row.enabled == 1,
      eventTypes: row.eventTypes,
      ...sourceView(row, this.#clock()),
      ...(row.pending == null ? {} : { lastError: `Source ${row.pending.action} is unfinished. Retry the same operation to complete it.` }),
      endpointUrl:
        origin == null
          ? null
          : eventSourceDefinition(row.kind).applicationIngress
            ? `${origin}/v1/event-source-apps/${encodeURIComponent(row.kind)}/${encodeURIComponent(String(row.config.appId))}/events`
            : `${origin}/v1/event-sources/${row.sourceId}/events`,
      lastReceivedAt: row.lastReceivedAt == null ? null : new Date(row.lastReceivedAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
      consumers: this.consumers(row.sourceId),
    }
  }

  reserve(input: CreateEventSource, fingerprint: string): StoredEventSource {
    return this.#transaction(() => {
      const kind = input.kind ?? 'feishu'
      const config = Object.fromEntries(
        Object.entries(input).filter(
          ([key]) => !['signingSecret', 'verificationToken', 'encryptKey', 'eventTypes', 'name', 'version', 'teamId', 'connectionId', 'kind'].includes(key),
        ),
      )
      const identity = JSON.stringify([input.teamId, input.connectionId, config])
      const existing = this.#database
        .prepare('SELECT source_id AS sourceId FROM event_sources WHERE kind = ? AND external_identity = ?')
        .get(kind, identity) as { sourceId: string } | undefined
      if (existing != null) {
        const source = this.require(existing.sourceId)
        if (source.connector!.creation !== fingerprint || (source.pending != null && source.pending.action !== 'create'))
          throw new ControlError(
            controlErrorCode.eventSourceConflict,
            'This workspace already has a Source. Retry the original creation or edit the existing Source.',
          )
        return source
      }
      const count = this.#database.prepare('SELECT COUNT(*) AS count FROM event_sources').get() as { count: number }
      if (count.count >= 100) throw new ControlError(controlErrorCode.eventSourceConflict, 'The deployment event source limit has been reached.')
      if (eventSourceDefinition(kind).applicationIngress && this.busy({ kind, teamId: input.teamId, config }))
        throw new ControlError(controlErrorCode.eventSourceConflict, 'Another Source operation for this application is unfinished.')
      const sourceId = `source_${randomUUID().replaceAll('-', '')}`
      const { value: deploymentId } = this.#database.prepare('SELECT value FROM event_source_namespace WHERE id = 1').get() as { value: string }
      this.#database
        .prepare(`INSERT INTO event_sources (source_id, revision, name, kind, provider, external_identity, connection_id,
        team_id, config_json, secrets_json, state_json, event_types_json, updated_at, connector_json, pending_json)
        VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, '{}', '{}', ?, ?, ?, ?)`)
        .run(
          sourceId,
          input.name,
          kind,
          eventSourceDefinition(kind).provider,
          identity,
          input.connectionId,
          input.teamId,
          JSON.stringify(config),
          JSON.stringify(input.eventTypes),
          this.#clock(),
          JSON.stringify({ deploymentId, requestKey: sourceId, creation: fingerprint }),
          JSON.stringify({ action: 'create', fingerprint }),
        )
      return this.require(sourceId)
    })
  }

  busy(source: Pick<StoredEventSource, 'kind' | 'teamId' | 'config'>): boolean {
    if (!eventSourceDefinition(source.kind).applicationIngress) return 'pending' in source && source.pending != null
    return (
      this.#database
        .prepare(`SELECT 1 FROM event_sources WHERE kind = ? AND team_id IS ?
      AND json_extract(config_json, '$.appId') = ? AND pending_json IS NOT NULL LIMIT 1`)
        .get(source.kind, source.teamId, String(source.config.appId)) != null
    )
  }

  beginChange(sourceId: string, revision: number, pending: z.infer<typeof pendingSchema>, input?: UpdateEventSource): StoredEventSource {
    return this.#transaction(() => {
      const source = this.require(sourceId, revision)
      if (source.pending != null && pending.action !== 'delete') {
        if (source.pending.action !== pending.action || source.pending.fingerprint !== pending.fingerprint)
          throw new ControlError(controlErrorCode.eventSourceConflict, 'Retry the unfinished Source operation before making another change.')
        return source
      }
      if (source.pending == null && this.busy(source))
        throw new ControlError(controlErrorCode.eventSourceConflict, 'Another Source operation for this application is unfinished.')
      if (pending.action === 'delete') this.#checkDelete(sourceId)
      if (input != null) this.#checkEvents(sourceId, input.eventTypes)
      this.#database.prepare('UPDATE event_sources SET pending_json = ? WHERE source_id = ?').run(JSON.stringify(pending), sourceId)
      return this.require(sourceId)
    })
  }

  saveReference(source: StoredEventSource, snapshot: SourceReferenceSnapshot, change?: UpdateEventSource | 'create'): boolean {
    const input = typeof change === 'object' ? change : undefined
    const complete = change != null
    return this.#transaction(() => {
      const current = this.require(source.sourceId)
      if (current.revision !== source.revision || (complete && !isDeepStrictEqual(current.pending, source.pending))) return false
      if (!complete && this.busy(current)) return false
      if (
        current.connector!.reference != null &&
        (current.connector!.reference.applicationId !== snapshot.reference.applicationId ||
          current.connector!.reference.sourceId !== snapshot.reference.sourceId)
      )
        throw new SourceIdentityError('Connector returned a different Source reference.')
      if ((current.connector!.revision ?? 0) > snapshot.revision) return false
      if (complete && input != null) this.#checkEvents(source.sourceId, snapshot.eventTypes)
      this.#database
        .prepare(`UPDATE event_sources SET connector_json = ?, state_json = ?, event_types_json = ?,
        name = ?, enabled = ?, pending_json = ?, revision = revision + ?, updated_at = ? WHERE source_id = ?`)
        .run(
          JSON.stringify({ ...current.connector, reference: snapshot.reference, revision: snapshot.revision }),
          JSON.stringify({ projection: { view: snapshot.view, ready: snapshot.ready, expiresAt: snapshot.expiresAt } }),
          JSON.stringify(snapshot.eventTypes),
          input?.name ?? current.name,
          input == null ? current.enabled : Number(input.enabled),
          complete || current.pending == null ? null : JSON.stringify(current.pending),
          input == null ? 0 : 1,
          complete ? this.#clock() : current.updatedAt,
          source.sourceId,
        )
      if (complete && input?.signingSecret != null && eventSourceDefinition(current.kind).applicationIngress) {
        this.#database
          .prepare(`UPDATE event_sources SET state_json = '{}', revision = revision + 1 WHERE kind = ?
          AND team_id IS ? AND json_extract(config_json, '$.appId') = ? AND source_id != ?`)
          .run(current.kind, current.teamId, String(current.config.appId), current.sourceId)
      }
      return true
    })
  }

  failChange(source: StoredEventSource): void {
    this.#database
      .prepare('UPDATE event_sources SET pending_json = NULL WHERE source_id = ? AND revision = ? AND pending_json = ?')
      .run(source.sourceId, source.revision, JSON.stringify(source.pending))
  }

  update(sourceId: string, input: UpdateEventSource): StoredEventSource {
    return this.#transaction(() => {
      this.require(sourceId, input.expectedRevision)
      this.#database
        .prepare('UPDATE event_sources SET name = ?, enabled = ?, revision = revision + 1, updated_at = ? WHERE source_id = ?')
        .run(input.name, Number(input.enabled), this.#clock(), sourceId)
      return this.require(sourceId)
    })
  }

  #checkEvents(sourceId: string, eventTypes: readonly string[]): void {
    const required = this.#database
      .prepare(`SELECT trigger_json AS triggerJson FROM integration_bindings
        WHERE current_publication_id IS NOT NULL AND json_extract(trigger_json, '$.config.sourceId.value') = ?
        UNION ALL SELECT trigger_json AS triggerJson FROM integration_candidates
        WHERE status != 'cleanup' AND json_extract(trigger_json, '$.config.sourceId.value') = ?`)
      .all(sourceId, sourceId) as { triggerJson: string }[]
    for (const row of required) {
      const trigger = JSON.parse(row.triggerJson) as Extract<TriggerNode, { kind: 'integration' }>
      const config = resolveTriggerConfig(trigger.definition.configInputs, trigger.config)
      const requiredTypes = config.eventTypes as readonly string[]
      if (requiredTypes.some((type) => !eventTypes.includes(type))) {
        throw new ControlError(controlErrorCode.eventSourceConflict, 'Published or preparing Triggers still require these event types.')
      }
    }
  }

  delete(sourceId: string, revision: number): void {
    this.#transaction(() => {
      this.require(sourceId, revision)
      this.#checkDelete(sourceId)
      for (const table of ['source_deliveries', 'source_events', 'source_event_versions', 'source_demands', 'event_sources'])
        this.#database.prepare(`DELETE FROM ${table} WHERE source_id = ?`).run(sourceId)
    })
  }

  #checkDelete(sourceId: string): void {
    if (
      this.consumers(sourceId).length > 0 ||
      this.#database.prepare('SELECT 1 FROM source_subscriptions WHERE source_id = ?').get(sourceId) != null ||
      this.#database
        .prepare("SELECT 1 FROM integration_candidates WHERE status != 'cleanup' AND json_extract(trigger_json, '$.config.sourceId.value') = ?")
        .get(sourceId) != null
    ) {
      throw new ControlError(
        controlErrorCode.eventSourceConflict,
        'Remove the source from published Triggers and finish subscription cleanup before deleting it.',
      )
    }
  }

  require(sourceId: string, revision?: number): StoredEventSource {
    const row = this.get(sourceId)
    if (row == null) throw new ControlError(controlErrorCode.eventSourceNotFound, 'Event source was not found.')
    if (revision != null && revision != row.revision)
      throw new ControlError(controlErrorCode.eventSourceConflict, 'Event source was changed. Reload before saving.')
    return row
  }

  consumers(sourceId: string): EventSource['consumers'] {
    return this.#database
      .prepare(`SELECT b.flow_id AS flowId, f.name AS flowName, b.trigger_node_id AS triggerNodeId
      FROM integration_bindings b JOIN flows f ON f.flow_id = b.flow_id
      WHERE b.current_publication_id IS NOT NULL AND json_extract(b.trigger_json, '$.config.sourceId.value') = ?
      ORDER BY f.name, b.trigger_node_id`)
      .all(sourceId) as unknown as EventSource['consumers']
  }

  private targets(source: StoredEventSource) {
    return this.#database
      .prepare(`SELECT b.binding_id AS bindingId, b.endpoint_id AS endpointId, b.current_publication_id AS publicationId,
        b.runtime_version AS runtimeVersion, b.trigger_json AS triggerJson FROM integration_bindings b
        JOIN flow_live l ON l.flow_id = b.flow_id AND l.publication_id = b.current_publication_id AND l.enabled = 1
        LEFT JOIN flow_connector_teams t ON t.flow_id = b.flow_id
        WHERE b.health = 'healthy' AND b.connection_id = ? AND t.team_id IS ?
          AND json_extract(b.trigger_json, '$.definition.provider') = ? AND json_extract(b.trigger_json, '$.config.sourceId.value') = ?`)
      .all(source.connectionId, source.teamId, source.provider, source.sourceId) as {
      bindingId: string
      endpointId: string
      publicationId: string
      runtimeVersion: number
      triggerJson: string
    }[]
  }

  consumersForEvent(source: StoredEventSource) {
    return this.targets(source).map((target) => {
      const trigger = JSON.parse(target.triggerJson) as Extract<TriggerNode, { kind: 'integration' }>
      return { id: JSON.stringify([target.bindingId, target.runtimeVersion]), config: resolveTriggerConfig(trigger.definition.configInputs, trigger.config) }
    })
  }

  receive(source: StoredEventSource, event: SourceEvent, now: number): 'accepted' | 'conflict' | 'overloaded' | 'unavailable' {
    return this.#transaction(() => {
      const current = this.get(source.sourceId)
      if (current == null || current.revision != source.revision || current.enabled != 1 || this.busy(current) || !sourceReady(current, now))
        return 'unavailable'
      const payloadJson = JSON.stringify(event.payload)
      const existing = this.#database
        .prepare('SELECT payload_json AS payloadJson FROM source_events WHERE source_id = ? AND event_id = ?')
        .get(source.sourceId, event.id) as { payloadJson: string } | undefined
      if (existing != null) return existing.payloadJson == payloadJson ? 'accepted' : 'conflict'
      if (event.ordering != null) {
        const previous = this.#database
          .prepare('SELECT version FROM source_event_versions WHERE source_id = ? AND stream_key = ?')
          .get(source.sourceId, event.ordering.key) as { version: number } | undefined
        if (previous != null && previous.version >= event.ordering.version) return 'accepted'
      }
      const count = this.#database.prepare("SELECT COUNT(*) AS count FROM source_deliveries WHERE status = 'pending'").get() as { count: number }
      const matched = new Set(event.matches)
      const matches = this.targets(source).filter((target) => matched.has(JSON.stringify([target.bindingId, target.runtimeVersion])))
      if (count.count + matches.length > 10_000) return 'overloaded'
      if (event.ordering != null)
        this.#database
          .prepare(
            'INSERT INTO source_event_versions VALUES (?, ?, ?, ?) ON CONFLICT(source_id, stream_key) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at',
          )
          .run(source.sourceId, event.ordering.key, event.ordering.version, now)
      this.#database.prepare('INSERT INTO source_events VALUES (?, ?, ?, ?)').run(source.sourceId, event.id, payloadJson, now)
      for (const target of matches) {
        this.#database
          .prepare(`INSERT INTO source_deliveries (source_id, event_id, binding_id, endpoint_id, publication_id, runtime_version, next_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(source.sourceId, event.id, target.bindingId, target.endpointId, target.publicationId, target.runtimeVersion, now)
      }
      this.#database.prepare('UPDATE event_sources SET last_received_at = ? WHERE source_id = ?').run(now, source.sourceId)
      return 'accepted'
    })
  }

  deliveries(now: number): readonly SourceDelivery[] {
    return this.#database
      .prepare(`SELECT d.source_id AS sourceId, d.event_id AS eventId, d.binding_id AS bindingId,
      d.endpoint_id AS endpointId, d.publication_id AS publicationId, d.runtime_version AS runtimeVersion, e.payload_json AS payloadJson
      FROM source_deliveries d JOIN source_events e USING (source_id, event_id)
      WHERE d.status = 'pending' AND d.next_at <= ? ORDER BY d.next_at LIMIT 100`)
      .all(now) as unknown as SourceDelivery[]
  }

  finish(delivery: SourceDelivery, status: 'delivered' | 'retired' | 'failed', errorCode?: string): void {
    this.#database
      .prepare("UPDATE source_deliveries SET status = ?, error_code = ? WHERE source_id = ? AND event_id = ? AND binding_id = ? AND status = 'pending'")
      .run(status, errorCode ?? null, delivery.sourceId, delivery.eventId, delivery.bindingId)
  }

  deliverable(delivery: SourceDelivery): boolean {
    return (
      this.#database
        .prepare(`SELECT 1 FROM integration_bindings b JOIN flow_live l ON l.flow_id = b.flow_id
      AND l.publication_id = b.current_publication_id WHERE b.binding_id = ? AND b.health = 'healthy' AND l.enabled = 1`)
        .get(delivery.bindingId) != null
    )
  }

  retry(delivery: SourceDelivery, now: number): void {
    this.#database
      .prepare("UPDATE source_deliveries SET next_at = ? WHERE source_id = ? AND event_id = ? AND binding_id = ? AND status = 'pending'")
      .run(now + 60_000, delivery.sourceId, delivery.eventId, delivery.bindingId)
  }

  nextAt(): number | undefined {
    return (this.#database.prepare("SELECT MIN(next_at) AS at FROM source_deliveries WHERE status = 'pending'").get() as { at: number | null }).at ?? undefined
  }

  subscription(sourceId: string, resourceKey: string): SourceSubscription | undefined {
    const row = this.#database
      .prepare(`SELECT source_id AS sourceId, resource_key AS resourceKey, resource_json AS resourceJson, status,
      provider_access_snapshot AS providerAccess
      FROM source_subscriptions WHERE source_id = ? AND resource_key = ?`)
      .get(sourceId, resourceKey) as (Omit<SourceSubscription, 'providerAccess'> & { readonly providerAccess: string }) | undefined
    return row == null ? undefined : { ...row, providerAccess: decodeConnectorAccessSnapshot(JSON.parse(row.providerAccess)) }
  }

  demand(
    sourceId: string,
    resourceKey: string,
    resourceJson: string,
    bindingId: string,
    providerAccess: ConnectorAccessSnapshot,
    now: number,
  ): SourceSubscription {
    return this.#transaction(() => {
      this.#database.prepare('INSERT OR IGNORE INTO source_demands VALUES (?, ?, ?)').run(sourceId, resourceKey, bindingId)
      this.#database
        .prepare(
          `INSERT OR IGNORE INTO source_subscriptions
           (source_id, resource_key, resource_json, status, updated_at, provider_access_snapshot)
           VALUES (?, ?, ?, 'creating', ?, ?)`,
        )
        .run(sourceId, resourceKey, resourceJson, now, JSON.stringify(providerAccess))
      return this.subscription(sourceId, resourceKey)!
    })
  }

  subscriptionState(sourceId: string, resourceKey: string, status: SourceSubscription['status'], now: number): void {
    this.#database
      .prepare('UPDATE source_subscriptions SET status = ?, updated_at = ? WHERE source_id = ? AND resource_key = ?')
      .run(status, now, sourceId, resourceKey)
  }

  release(bindingId: string): void {
    this.#database.prepare('DELETE FROM source_demands WHERE binding_id = ?').run(bindingId)
  }

  unusedSubscriptions(): readonly SourceSubscription[] {
    this.#database
      .prepare(`DELETE FROM source_demands WHERE NOT EXISTS
      (SELECT 1 FROM integration_bindings b WHERE b.binding_id = source_demands.binding_id AND b.current_publication_id IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM integration_candidates c JOIN publish_operations p USING (operation_id)
      WHERE c.binding_id = source_demands.binding_id AND c.status != 'cleanup' AND p.status = 'pending')`)
      .run()
    const rows = this.#database
      .prepare(`SELECT source_id AS sourceId, resource_key AS resourceKey, resource_json AS resourceJson, status,
      provider_access_snapshot AS providerAccess
      FROM source_subscriptions s WHERE (s.status = 'ready' OR s.updated_at <= ?) AND NOT EXISTS (SELECT 1 FROM source_demands d WHERE d.source_id = s.source_id AND d.resource_key = s.resource_key)
      LIMIT 100`)
      .all(this.#clock() - 60_000) as unknown as readonly (Omit<SourceSubscription, 'providerAccess'> & { readonly providerAccess: string })[]
    const subscriptions: SourceSubscription[] = []
    for (const { providerAccess, ...row } of rows) {
      subscriptions.push({ ...row, providerAccess: decodeConnectorAccessSnapshot(JSON.parse(providerAccess)) })
    }
    return subscriptions
  }

  deleteSubscription(sourceId: string, resourceKey: string): void {
    this.#database.prepare('DELETE FROM source_subscriptions WHERE source_id = ? AND resource_key = ?').run(sourceId, resourceKey)
  }

  ready(sourceId: string, bindingId: string): boolean {
    const source = this.get(sourceId)
    return (
      source?.enabled == 1 &&
      !this.busy(source) &&
      sourceReady(source, this.#clock()) &&
      this.#database
        .prepare(`SELECT 1 FROM source_demands d
      JOIN source_subscriptions s USING (source_id, resource_key) WHERE d.binding_id = ? AND s.status != 'ready'`)
        .get(bindingId) == null
    )
  }

  prune(now: number): void {
    const cutoff = now - 30 * 24 * 60 * 60 * 1000
    this.#database.prepare('DELETE FROM source_event_versions WHERE updated_at < ?').run(cutoff)
    this.#database
      .prepare(`DELETE FROM source_deliveries WHERE status != 'pending' AND EXISTS
      (SELECT 1 FROM source_events e WHERE e.source_id = source_deliveries.source_id AND e.event_id = source_deliveries.event_id AND e.received_at < ?)`)
      .run(cutoff)
    this.#database
      .prepare(`DELETE FROM source_events WHERE received_at < ? AND NOT EXISTS
      (SELECT 1 FROM source_deliveries d WHERE d.source_id = source_events.source_id AND d.event_id = source_events.event_id)`)
      .run(cutoff)
  }
}
