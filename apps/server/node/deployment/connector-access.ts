import type { ConnectorAccess, ConnectorAccessCandidates } from '@oomol-lab/open-flow/control-api'
import type { ConnectorTeamStore } from '../storage/connector-team-store.ts'
import type { Database } from '../storage/database.ts'
import type { ConnectorHost } from './connector.ts'

import { decodeConnectorAccess } from '@oomol-lab/open-flow/control-api'
import { createHash } from 'node:crypto'
import { ConnectorClient } from './connector.ts'

export type ConnectorAccessMutation =
  | { readonly kind: 'conflict' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'saved'; readonly access: ConnectorAccess }
  | { readonly kind: 'unsupported' }

export interface ConnectorAccessHost {
  setService(actorId: string, flowId: string, providerId: string, selected: boolean, expectedAccessRevision: number): Promise<ConnectorAccessMutation>
  delete(flowId: string): boolean
  current(flowId: string): ConnectorAccess
  listCandidates(actorId: string, flowId: string, providerId: string, signal?: AbortSignal): Promise<ConnectorAccessCandidates>
  read(actorId: string, flowId: string): ConnectorAccess
  add(actorId: string, flowId: string, providerId: string, accessBindingId: string, expectedAccessRevision: number): Promise<ConnectorAccessMutation>
  remove(actorId: string, flowId: string, providerId: string, accessBindingId: string, expectedAccessRevision: number): Promise<ConnectorAccessMutation>
}

export class ImplicitConnectorAccessHost implements ConnectorAccessHost {
  async setService(
    _actorId: string,
    _flowId: string,
    _providerId: string,
    _selected: boolean,
    _expectedAccessRevision: number,
  ): Promise<ConnectorAccessMutation> {
    return { kind: 'unsupported' }
  }

  current(_flowId: string): ConnectorAccess {
    return implicitAccess()
  }

  delete(_flowId: string): boolean {
    return true
  }

  read(_actorId: string, flowId: string): ConnectorAccess {
    return this.current(flowId)
  }

  async listCandidates(_actorId: string, _flowId: string, providerId: string): Promise<ConnectorAccessCandidates> {
    return { candidates: [], mode: 'implicit', providerId, version: 1 }
  }

  async add(
    _actorId: string,
    _flowId: string,
    _providerId: string,
    _accessBindingId: string,
    _expectedAccessRevision: number,
  ): Promise<ConnectorAccessMutation> {
    return { kind: 'unsupported' }
  }

  async remove(
    _actorId: string,
    _flowId: string,
    _providerId: string,
    _accessBindingId: string,
    _expectedAccessRevision: number,
  ): Promise<ConnectorAccessMutation> {
    return { kind: 'unsupported' }
  }
}

export class ConfiguredConnectorAccessHost implements ConnectorAccessHost {
  readonly #database: Database
  readonly #resolveConnector: () => ConnectorHost | undefined
  readonly #teams: ConnectorTeamStore

  constructor(database: Database, teams: ConnectorTeamStore, resolveConnector: () => ConnectorHost | undefined) {
    this.#database = database
    this.#resolveConnector = resolveConnector
    this.#teams = teams
  }

  current(flowId: string): ConnectorAccess {
    if (this.#connector() == null) return implicitAccess()
    const row = this.#database.connection
      .prepare(
        'SELECT access_revision AS accessRevision, bindings_json AS bindings, provider_ids_json AS providerIds, provider_access_digest AS providerAccessDigest FROM flow_provider_access WHERE flow_id = ?',
      )
      .get(flowId) as
      | { readonly accessRevision: number; readonly bindings: string; readonly providerIds: string; readonly providerAccessDigest: string }
      | undefined
    return row == null
      ? selectableAccess(0, [])
      : decodeConnectorAccess({
          accessRevision: row.accessRevision,
          providerIds: JSON.parse(row.providerIds) as readonly string[],
          bindings: JSON.parse(row.bindings) as ConnectorAccess['bindings'],
          mode: 'selectable',
          providerAccessDigest: row.providerAccessDigest,
          version: 1,
        })
  }

  delete(flowId: string): boolean {
    this.#database.connection.prepare('DELETE FROM flow_provider_access WHERE flow_id = ?').run(flowId)
    return true
  }

  read(_actorId: string, flowId: string): ConnectorAccess {
    return this.current(flowId)
  }

  async listCandidates(_actorId: string, flowId: string, providerId: string, signal?: AbortSignal): Promise<ConnectorAccessCandidates> {
    const connector = this.#connector()
    if (connector == null) return { candidates: [], mode: 'implicit', providerId, version: 1 }
    const teamId = await this.#team(flowId, connector, signal)
    return {
      candidates: await connector.listProviderAccessBindingCandidates(teamId, providerId, signal),
      mode: 'selectable',
      providerId,
      version: 1,
    }
  }

  async add(_actorId: string, flowId: string, providerId: string, accessBindingId: string, expectedAccessRevision: number): Promise<ConnectorAccessMutation> {
    const connector = this.#connector()
    if (connector == null) return { kind: 'unsupported' }
    const teamId = await this.#team(flowId, connector)
    const candidate = (await connector.listProviderAccessBindingCandidates(teamId, providerId)).find((item) => item.accessBindingId == accessBindingId)
    if (candidate == null) return { kind: 'invalid' }
    const current = this.current(flowId)
    if (current.accessRevision != expectedAccessRevision) return { kind: 'conflict' }
    const { isDefault: _isDefault, permissions: _permissions, ...binding } = candidate
    const bindings = [
      ...current.bindings.filter((existing) => existing.providerId != providerId || existing.accessBindingId != accessBindingId),
      { ...binding, status: 'active' as const },
    ].toSorted(compareBindings)
    return this.#save(flowId, expectedAccessRevision, bindings, [...new Set([...(current.providerIds ?? []), providerId])].toSorted())
  }

  async remove(
    _actorId: string,
    flowId: string,
    providerId: string,
    accessBindingId: string,
    expectedAccessRevision: number,
  ): Promise<ConnectorAccessMutation> {
    if (this.#connector() == null) return { kind: 'unsupported' }
    const current = this.current(flowId)
    if (current.accessRevision != expectedAccessRevision) return { kind: 'conflict' }
    if (!current.bindings.some((binding) => binding.providerId == providerId && binding.accessBindingId == accessBindingId)) return { kind: 'invalid' }
    return this.#save(
      flowId,
      expectedAccessRevision,
      current.bindings.filter((binding) => binding.providerId != providerId || binding.accessBindingId != accessBindingId),
      [...new Set([...(current.providerIds ?? []), providerId])].toSorted(),
    )
  }

  async setService(_actorId: string, flowId: string, providerId: string, selected: boolean, expectedAccessRevision: number): Promise<ConnectorAccessMutation> {
    const connector = this.#connector()
    if (connector == null) return { kind: 'unsupported' }
    if (selected) {
      const providers = await connector.listProviders(undefined, await this.#team(flowId, connector))
      if (!providers.some((provider) => provider.serviceId == providerId && !provider.noSetup)) return { kind: 'invalid' }
    }
    const current = this.current(flowId)
    if (current.accessRevision != expectedAccessRevision) return { kind: 'conflict' }
    const providerIds = new Set(current.providerIds ?? [])
    if (selected) providerIds.add(providerId)
    else providerIds.delete(providerId)
    return this.#save(
      flowId,
      expectedAccessRevision,
      selected ? current.bindings : current.bindings.filter((binding) => binding.providerId != providerId),
      [...providerIds].toSorted(),
    )
  }

  #connector(): ConnectorClient | undefined {
    const connector = this.#resolveConnector()
    return connector instanceof ConnectorClient && connector.teamSupported() ? connector : undefined
  }

  #save(flowId: string, expectedAccessRevision: number, bindings: ConnectorAccess['bindings'], providerIds: readonly string[]): ConnectorAccessMutation {
    const access = selectableAccess(expectedAccessRevision + 1, bindings, providerIds)
    const result = this.#database.connection
      .prepare(
        `INSERT INTO flow_provider_access (flow_id, access_revision, bindings_json, provider_access_digest, provider_ids_json)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (flow_id) DO UPDATE SET
           access_revision = excluded.access_revision,
           bindings_json = excluded.bindings_json,
           provider_ids_json = excluded.provider_ids_json,
           provider_access_digest = excluded.provider_access_digest
         WHERE flow_provider_access.access_revision = ?`,
      )
      .run(flowId, access.accessRevision, JSON.stringify(bindings), access.providerAccessDigest, JSON.stringify(providerIds), expectedAccessRevision)
    return result.changes == 0 ? { kind: 'conflict' } : { access, kind: 'saved' }
  }

  async #team(flowId: string, connector: ConnectorClient, signal?: AbortSignal): Promise<string> {
    const assigned = this.#teams.get(flowId)
    if (assigned != null) return assigned
    const defaultTeam = (await connector.listTeams(signal)).find((team) => team.systemCreated)
    if (defaultTeam == null) throw new Error('The default OOMOL Team is unavailable.')
    return this.#teams.bind(flowId, defaultTeam.id) ?? defaultTeam.id
  }
}

function implicitAccess(): ConnectorAccess {
  return { accessRevision: 0, bindings: [], mode: 'implicit', providerAccessDigest: 'implicit', version: 1 }
}

function selectableAccess(accessRevision: number, bindings: ConnectorAccess['bindings'], providerIds: readonly string[] = []): ConnectorAccess {
  const payload = JSON.stringify(bindings.map((binding) => [binding.providerId, binding.accessBindingId]))
  return {
    accessRevision,
    providerIds,
    bindings,
    mode: 'selectable',
    providerAccessDigest: `sha256:${createHash('sha256').update(payload).digest('hex')}`,
    version: 1,
  }
}

function compareBindings(left: ConnectorAccess['bindings'][number], right: ConnectorAccess['bindings'][number]): number {
  return left.providerId.localeCompare(right.providerId) || left.accessBindingId.localeCompare(right.accessBindingId)
}
