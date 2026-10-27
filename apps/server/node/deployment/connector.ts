import type { ConnectorProxyRequest, ConnectorProxyResult, TriggerOperationRequest } from '@oomol-lab/open-flow/connector-proxy'
import type {
  ProviderAccessReference,
  ConnectorAccessCandidates,
  ConnectorAccessGrant,
  ConnectorActionMetadata,
  ConnectorConnection,
  ConnectorProvider,
} from '@oomol-lab/open-flow/control-api'
import type { JsonValue } from '@oomol-lab/open-flow/flow-change'
import type { Logger } from 'pino'
import type { ConnectorAccessContext, ConnectorHost } from './connector-contract.ts'
import type { ResponseBudget, RuntimeAction } from './connector-response.ts'
import type { ResolvedProviderAccessBinding, TeamAppAccess } from './provider-access.ts'

import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import { silentLogger } from '../logger.ts'
import { accessInvalid, assertConnectionNotDeferred, connectionRequired, ConnectorTaskError, unavailable } from './connector-contract.ts'
import {
  connectorFailureDetails,
  mapAction,
  mapActions,
  record,
  runtimeAction,
  runtimeConnection,
  runtimeData,
  runtimeList,
  runtimeProvider,
  runtimeTeam,
} from './connector-response.ts'
import { ConnectorTransport, maxResponseBytes, RequestError } from './connector-transport.ts'
import {
  providerAccessAllowsAction,
  providerAccessAllowsProxy,
  providerAccessAllowsTrigger,
  providerAccessBindingCandidates,
  providerAccessConnections,
  resolveProviderAccessBinding,
} from './provider-access.ts'

const maxActionResponseBytes = 32 * 1024 * 1024
const maxActionCatalogBytes = 8 * 1024 * 1024
const catalogConcurrency = 16
const readinessTimeoutMs = 1_000
const hostedAccessFreshMs = 5 * 60 * 1_000

function selectedGrants(access: Exclude<ConnectorAccessContext, { readonly scope: 'catalog' }>): readonly ConnectorAccessGrant[] {
  switch (access.scope) {
    case 'shared':
      return access.providerAccess.sharedBindings
    case 'selected':
      return access.providerAccess.selectedBindings
    case 'action':
    case 'proxy':
    case 'trigger':
      return access.providerAccess.selectedBindings.filter((binding) => binding.connectionId == access.connectionId)
  }
}

type ConnectorClientAccess = ConnectorAccessContext | string

function connectorTeamId(access: ConnectorClientAccess | undefined): string | undefined {
  return typeof access == 'string' ? access : access?.teamId
}

export class ConnectorClient implements ConnectorHost {
  readonly #apiOrigin?: URL
  readonly #logger: Logger
  readonly #origin: URL
  readonly #teamOrigin?: URL
  readonly #transport: ConnectorTransport
  readonly #token: string
  readonly #teamAccess = new Map<string, { readonly expiresAt: number; readonly value: TeamAppAccess }>()
  #userId?: string

  constructor(origin: string, token: string, timeoutMs = 30_000, logger: Logger = silentLogger) {
    const url = new URL(origin)
    if (url.protocol != 'http:' && url.protocol != 'https:') throw new Error('Connector origin must use HTTP.')
    if (url.username != '' || url.password != '' || url.search != '' || url.hash != '') {
      throw new Error('Connector origin must not contain credentials, a query, or a fragment.')
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('Connector timeout must be a positive integer.')
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/`
    this.#logger = logger.child({ component: 'connector' })
    this.#origin = url
    if (url.hostname == 'connector.oomol.com' || url.hostname == 'connector.oomol.dev') {
      const domain = url.hostname.slice('connector.'.length)
      this.#apiOrigin = new URL(`https://api.${domain}/`)
      this.#teamOrigin = new URL(`https://relation-control.${domain}/`)
    }
    this.#transport = new ConnectorTransport(url, token, timeoutMs, this.#logger)
    this.#token = token
  }

  teamSupported(): boolean {
    return this.#teamOrigin != null && this.#token.length > 0
  }

  hostedConsoleOrigin(): URL | undefined {
    if (!this.teamSupported()) return
    return new URL(`https://console.${this.#origin.hostname.slice('connector.'.length)}/`)
  }

  async hostedConnectionPage(serviceId: string, teamId?: string, signal?: AbortSignal): Promise<string> {
    if (!this.teamSupported()) throw unavailable()
    const teams = await this.listTeams(signal)
    const team = teamId == null ? teams.find((item) => item.systemCreated) : teams.find((item) => item.id == teamId)
    if (team == null) throw unavailable('The Connector Team for this connection page is not available.')
    return new URL(`team/${encodeURIComponent(team.name)}/connections/${encodeURIComponent(serviceId)}`, this.hostedConsoleOrigin()).href
  }

  async listTeams(signal?: AbortSignal): Promise<readonly { readonly id: string; readonly name: string; readonly systemCreated: boolean }[]> {
    if (this.#teamOrigin == null || this.#token.length == 0) throw unavailable()
    const response = await this.#transport.request('teams.list', 'v1/me/teams', { method: 'GET' }, signal, { origin: this.#teamOrigin })
    if (!response.ok) throw unavailable()
    return this.#transport.decode('teams.list', { upstreamOrigin: this.#teamOrigin.origin, upstreamPath: '/v1/me/teams' }, () => {
      if (!record(response.value) || !Array.isArray(response.value.teams)) throw unavailable()
      return response.value.teams.map(runtimeTeam)
    })
  }

  async listProviderAccessBindingCandidates(
    teamId: string,
    providerIds: readonly string[],
    signal?: AbortSignal,
  ): Promise<{
    readonly results: readonly (ConnectorAccessCandidates | { readonly providerId: string; readonly error: Pick<ConnectorTaskError, 'code' | 'message'> })[]
    readonly version: 1
  }> {
    const context = await this.#providerAccessContext(teamId, providerIds, signal)
    const results = await Promise.all(
      providerIds.map(async (providerId) => {
        signal?.throwIfAborted()
        try {
          const candidates = await providerAccessBindingCandidates({ ...context, providerId, teamId })
          return { providerId, candidates, mode: 'selectable' as const, version: 1 as const }
        } catch (error) {
          signal?.throwIfAborted()
          if (!(error instanceof TypeError) && !(error instanceof ConnectorTaskError)) throw error
          const failure = error instanceof ConnectorTaskError ? error : unavailable('Connector access candidates could not be loaded.')
          return { providerId, error: { code: failure.code, message: failure.message } }
        }
      }),
    )
    return { results, version: 1 }
  }

  async #providerAccessContext(teamId: string, providerIds: readonly string[], signal?: AbortSignal, catalog?: readonly ConnectorConnection[]) {
    if (this.#teamOrigin == null || this.#token.length == 0) throw unavailable()
    const response = await this.#transport.request('teams.membership', 'v1/me/teams', { method: 'GET' }, signal, { origin: this.#teamOrigin })
    if (!response.ok || !record(response.value) || !Array.isArray(response.value.teams)) throw unavailable('The OOMOL Team membership could not be loaded.')
    const team = response.value.teams.find((entry: unknown) => record(entry) && entry.id == teamId)
    if (!record(team) || team.deleted !== false || team.status != 'normal') throw accessInvalid()
    if (team.role != 'creator' && team.role != 'admin' && team.role != 'member') throw accessInvalid()
    const teamAdmin = team.role == 'creator' || team.role == 'admin'
    const [actorId, connections, access] = await Promise.all([
      teamAdmin ? Promise.resolve('') : this.#oomolUserId(signal),
      catalog ?? this.#connections(providerIds.length == 1 ? providerIds[0] : undefined, signal, teamId),
      teamAdmin ? Promise.resolve({ policy: {} }) : this.#readTeamAppAccess(teamId, signal),
    ])
    return { actorId, connections, ...access, teamAdmin }
  }

  async #oomolUserId(signal?: AbortSignal): Promise<string> {
    if (this.#apiOrigin == null || this.#token.length == 0) throw unavailable()
    if (this.#userId != null) return this.#userId
    const response = await this.#transport.request('user.profile', 'v1/users/profile', { method: 'GET' }, signal, { origin: this.#apiOrigin })
    if (!response.ok) throw unavailable('The OOMOL user profile could not be loaded.')
    const envelope = record(response.value) && response.value.success === true && record(response.value.data) ? response.value.data : response.value
    if (!record(envelope) || typeof envelope.uid != 'string' || envelope.uid.length == 0) {
      throw unavailable('The OOMOL user profile was invalid.')
    }
    this.#userId = envelope.uid
    return envelope.uid
  }

  async #readTeamAppAccess(teamId: string, signal?: AbortSignal): Promise<TeamAppAccess> {
    if (this.#teamOrigin == null || this.#token.length == 0) throw unavailable()
    const cached = this.#teamAccess.get(teamId)
    if (cached != null && cached.expiresAt > Date.now()) return cached.value
    const response = await this.#transport.request('team.app-access', `v1/teams/${encodeURIComponent(teamId)}/app-access`, { method: 'GET' }, signal, {
      maximumResponseBytes: maxActionCatalogBytes,
      origin: this.#teamOrigin,
    })
    if (!response.ok || !record(response.value)) throw unavailable('The OOMOL Team Connector access could not be loaded.')
    const policyRevision = response.headers.get('etag')?.trim()
    const value = { policy: response.value, ...(policyRevision ? { policyRevision } : {}) }
    this.#teamAccess.set(teamId, { expiresAt: Date.now() + hostedAccessFreshMs, value })
    return value
  }

  async ready(): Promise<boolean> {
    try {
      const response = await fetch(new URL('health', this.#origin), {
        redirect: 'error',
        signal: AbortSignal.timeout(readinessTimeoutMs),
      })
      await response.body?.cancel()
      return response.ok
    } catch {
      return false
    }
  }

  async listProviders(signal?: AbortSignal, access?: ConnectorClientAccess, locale?: string): Promise<readonly ConnectorProvider[]> {
    const teamId = connectorTeamId(access)
    let providers = await this.#providers(signal, teamId, locale)
    if (selectableAccess(access) && access.scope != 'catalog') {
      const allowed = new Set(selectedGrants(access).map((binding) => binding.providerId))
      providers = providers.filter((provider) => allowed.has(provider.serviceId))
    }
    return providers.map((provider) =>
      Object.assign(
        { serviceId: provider.serviceId, serviceName: provider.serviceName },
        provider.noSetup ? { noSetup: true } : {},
        provider.homepageUrl == null ? {} : { homepageUrl: provider.homepageUrl },
        provider.icon == null ? {} : { icon: provider.icon },
        provider.iconSprite == null ? {} : { iconSprite: provider.iconSprite, iconSpritePosition: provider.iconSpritePosition },
      ),
    )
  }

  async #providers(signal?: AbortSignal, teamId?: string, locale?: string) {
    return this.#transport.get(
      'providers.list',
      'v1/providers',
      (data) => runtimeList(runtimeData(data), (item) => runtimeProvider(item, record(data) && record(data.meta) ? data.meta.iconSprite : undefined)),
      signal,
      { teamId, locale },
    )
  }

  async listActions(serviceId?: string, signal?: AbortSignal, access?: ConnectorClientAccess, locale?: string): Promise<readonly ConnectorActionMetadata[]> {
    const teamId = connectorTeamId(access)
    if (serviceId != null) {
      const bindings = typeof access == 'object' && access.scope == 'catalog' ? null : await this.#providerAccessBindings(access, serviceId, signal)
      if (bindings != null && bindings.length == 0) return []
      const [providers, actions] = await Promise.all([
        this.#providers(signal, teamId, locale),
        this.#actions(`v1/actions?service=${encodeURIComponent(serviceId)}`, false, signal, teamId, { serviceId }, undefined, locale),
      ])
      const mapped = this.#transport.decode('actions.list', { serviceId }, () => mapActions(actions, providers))
      return bindings == null ? mapped : mapped.filter((action) => bindings.some((binding) => providerAccessAllowsAction(binding, action)))
    }
    const bindings = typeof access == 'object' && access.scope == 'catalog' ? null : await this.#accessBindings(access, signal)
    if (bindings != null && bindings.length == 0) return []
    return await Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        const catalogProviders = yield* Effect.tryPromise({ try: (requestSignal) => this.#providers(requestSignal, teamId, locale), catch: (error) => error })
        const providers =
          bindings == null ? catalogProviders : catalogProviders.filter((provider) => bindings.some((binding) => binding.providerId == provider.serviceId))
        const exhausted = Deferred.makeUnsafe<never, ConnectorTaskError>()
        let catalogError: ConnectorTaskError | undefined
        const budget = {
          exhaust: (responseBytes: number) => {
            if (catalogError != null) return catalogError
            catalogError = unavailable()
            this.#logger.warn(
              {
                category: 'connector.request.failed',
                failure: 'response-too-large',
                limitBytes: maxActionCatalogBytes,
                operation: 'actions.list',
                responseBytes,
                upstreamOrigin: this.#origin.origin,
              },
              'Connector Action catalog was too large.',
            )
            Deferred.doneUnsafe(exhausted, Effect.fail(catalogError))
            return catalogError
          },
          limit: maxActionCatalogBytes,
          used: 0,
        }
        const catalogs = yield* Effect.forEach(
          providers,
          (provider) =>
            Effect.tryPromise({
              try: (requestSignal) =>
                this.#actions(
                  `v1/actions?service=${encodeURIComponent(provider.serviceId)}`,
                  false,
                  requestSignal,
                  teamId,
                  { serviceId: provider.serviceId },
                  budget,
                  locale,
                ),
              catch: (error) => error,
            }),
          { concurrency: catalogConcurrency },
        ).pipe(Effect.raceFirst(Deferred.await(exhausted)))
        const mapped = this.#transport.decode('actions.list', {}, () => mapActions(catalogs.flat(), providers))
        return bindings == null
          ? mapped
          : mapped.filter((action) => {
              return bindings.some((binding) => binding.providerId == action.serviceId && providerAccessAllowsAction(binding, action))
            })
      }),
      { signal },
    )
  }

  async searchActions(query: string, signal?: AbortSignal, access?: ConnectorClientAccess, locale?: string): Promise<readonly ConnectorActionMetadata[]> {
    const teamId = connectorTeamId(access)
    const bindings = typeof access == 'object' && access.scope == 'catalog' ? null : await this.#accessBindings(access, signal)
    if (bindings != null && bindings.length == 0) return []
    const [providers, actions] = await Promise.all([
      this.#providers(signal, teamId, locale),
      this.#actions(`v1/actions/search?q=${encodeURIComponent(query)}`, true, signal, teamId, {}, undefined, locale),
    ])
    const mapped = this.#transport.decode('actions.search', {}, () => mapActions(actions, providers))
    return bindings == null
      ? mapped
      : mapped.filter((action) => {
          return bindings.some((binding) => binding.providerId == action.serviceId && providerAccessAllowsAction(binding, action))
        })
  }

  async getAction(actionId: string, signal?: AbortSignal, access?: ConnectorClientAccess, locale?: string): Promise<ConnectorActionMetadata> {
    const teamId = connectorTeamId(access)
    const separator = actionId.indexOf('.')
    if (separator <= 0) throw actionNotFound()
    const bindings =
      typeof access == 'object' && access.scope == 'catalog' ? null : await this.#providerAccessBindings(access, actionId.slice(0, separator), signal, true)
    const [providers, action] = await Promise.all([
      this.#providers(signal, teamId, locale),
      this.#transport.get('actions.get', `v1/actions/${encodeURIComponent(actionId)}`, (data) => runtimeAction(runtimeData(data)), signal, {
        fields: { actionId },
        teamId,
        locale,
        failure: (data) => (record(data) && data.success === false && data.errorCode === 'unknown_action' ? actionNotFound() : unavailable()),
      }),
    ])
    const mapped = this.#transport.decode('actions.get', { actionId }, () => mapAction(action, providers))
    if (bindings != null && !bindings.some((binding) => providerAccessAllowsAction(binding, mapped))) throw accessInvalid()
    return mapped
  }

  async listAllConnections(signal?: AbortSignal, access?: ConnectorClientAccess): Promise<readonly ConnectorConnection[]> {
    const connections = await this.#connections(undefined, signal, connectorTeamId(access))
    if (selectableAccess(access) && access.scope == 'catalog') return this.#visibleConnections(access, connections, signal)
    const bindings = await this.#accessBindings(access, signal, connections)
    if (bindings == null) return connections
    const allowed = new Set(bindings.map((binding) => binding.appId))
    return connections.filter((connection) => allowed.has(connection.connectionId))
  }

  async listConnections(serviceId: string, signal?: AbortSignal, access?: ConnectorClientAccess): Promise<readonly ConnectorConnection[]> {
    if (selectableAccess(access) && access.scope == 'catalog')
      return this.#visibleConnections(access, await this.#connections(serviceId, signal, access.teamId), signal)
    const bindings = await this.#providerAccessBindings(access, serviceId, signal)
    return bindings == null ? await this.#connections(serviceId, signal, connectorTeamId(access)) : bindings.map((binding) => binding.connection)
  }

  async execute(
    action: string,
    connectionId: string | undefined,
    input: Readonly<Record<string, JsonValue>>,
    invocationId: string,
    signal: AbortSignal,
    access?: ConnectorClientAccess,
  ): Promise<JsonValue> {
    assertConnectionNotDeferred(connectionId)
    if (typeof access == 'object' && access.scope != 'shared' && (access.scope != 'action' || access.action != action || access.connectionId != connectionId))
      throw accessInvalid('The Action or Connection is outside this invocation’s access scope.')
    const teamId = connectorTeamId(access)
    const separator = action.indexOf('.')
    if (separator <= 0) throw connectionRequired()
    const providerId = action.slice(0, separator)
    if (connectionId != null && selectableAccess(access) && !selectedGrants(access).some((binding) => binding.providerId == providerId)) throw accessRequired()
    if (
      typeof access == 'object' &&
      access.scope == 'action' &&
      connectionId == null &&
      !(await this.#providers(signal, teamId)).some((provider) => provider.serviceId == providerId && provider.noSetup)
    )
      throw connectionRequired()
    const publicAction =
      connectionId == null &&
      typeof access == 'object' &&
      access.providerAccess.mode == 'selectable' &&
      !(await this.getAction(action, signal, access)).authenticated
    const bindings = publicAction ? null : await this.#providerAccessBindings(access, providerId, signal, true)
    if (bindings != null) {
      const binding =
        connectionId == null
          ? bindings.length == 1
            ? bindings[0]
            : bindings.find((candidate) => candidate.connection.isDefault)
          : bindings.find((candidate) => candidate.appId == connectionId && providerAccessAllowsAction(candidate, { actionId: action, serviceId: providerId }))
      if (binding == null) throw connectionId == null ? connectionRequired() : accessInvalid()
      if (!providerAccessAllowsAction(binding, { actionId: action, serviceId: providerId })) throw accessInvalid()
      if (binding.accessGrant.appAccessConfig != null) {
        throw accessInvalid('This Provider access binding requires the hosted Flow runtime.')
      }
      connectionId = binding.appId
    }
    if (connectionId != null) await this.#assertConnection(connectionId, providerId, signal, teamId)

    const actionResponse = await this.#transport
      .request(
        'action.execute',
        `v1/actions/${encodeURIComponent(action)}`,
        {
          body: JSON.stringify({ input }),
          headers: {
            'content-type': 'application/json',
            'idempotency-key': invocationId,
            ...(connectionId == null ? {} : { 'x-oo-connector-app-id': connectionId }),
          },
          method: 'POST',
        },
        signal,
        { fields: { actionId: action, ...(connectionId == null ? {} : { connectionId }), invocationId }, maximumResponseBytes: maxActionResponseBytes, teamId },
      )
      .catch((error: unknown) => {
        if (signal.aborted) throw signal.reason
        if (!(error instanceof RequestError)) throw error
        throw new ConnectorTaskError(
          'connector.indeterminate',
          `${error.reason}${error.status == null ? '' : ` (HTTP ${error.status})`}. The action outcome is unknown.`,
        )
      })
    const response = actionResponse.value
    if (!record(response))
      throw new ConnectorTaskError(
        'connector.indeterminate',
        `Connector returned an invalid action response (HTTP ${actionResponse.status}). The action outcome is unknown.`,
      )
    if (actionResponse.ok && response.success === true && Object.hasOwn(response, 'data')) return response.data as JsonValue
    if (response.errorCode === 'credential_expired' || response.errorCode === 'connection_not_allowed' || response.errorCode === 'connection_not_found')
      throw connectionRequired()
    const failure = actionFailure(response)
    if (failure.code == 'connector.input-invalid') throw failure
    throw new ConnectorTaskError(
      'connector.indeterminate',
      `Connector ${response.success === false ? 'reported an action failure' : 'returned an unexpected action response'} (HTTP ${actionResponse.status}). The action outcome is unknown.`,
    )
  }

  async trigger(
    provider: string,
    connectionId: string,
    triggerId: string,
    request: TriggerOperationRequest,
    signal: AbortSignal,
    access?: ConnectorClientAccess,
  ): Promise<unknown> {
    if (
      typeof access == 'object' &&
      access.scope != 'catalog' &&
      (access.scope != 'trigger' || access.triggerId != triggerId || access.providerId != provider || access.connectionId != connectionId)
    )
      throw accessInvalid()
    const sourceIngress = request.operation === 'sourceReference' && (request.request.action === 'delete' || request.request.action === 'route')
    if (sourceIngress && (typeof access !== 'object' || access.scope !== 'catalog' || access.source !== 'operator')) throw accessInvalid()
    const bindings = sourceIngress ? null : await this.#providerAccessBindings(access, provider, signal, true)
    if (bindings != null && !bindings.some((candidate) => candidate.appId == connectionId && providerAccessAllowsTrigger(candidate, triggerId)))
      throw accessInvalid()
    const teamId = connectorTeamId(access)
    if (!sourceIngress) await this.#assertConnection(connectionId, provider, signal, teamId)
    const response = await this.#transport.request(
      'trigger.execute',
      `v1/providers/${encodeURIComponent(provider)}/triggers/${encodeURIComponent(triggerId)}/execute?appId=${encodeURIComponent(connectionId)}`,
      {
        method: 'POST',
        body: JSON.stringify(request),
        headers: { 'content-type': 'application/json' },
      },
      signal,
      { fields: { connectionId, provider, triggerId }, teamId },
    )
    if (response.ok && record(response.value) && response.value.success === true && 'data' in response.value) return response.value.data
    if (
      record(response.value) &&
      ['scope_missing', 'credential_expired', 'connection_not_allowed', 'connection_not_found', 'trigger_connection_error'].includes(
        String(response.value.errorCode),
      )
    )
      throw connectionRequired()
    if (record(response.value) && response.value.errorCode === 'trigger_quota_exceeded')
      throw new ConnectorTaskError('connector.input-invalid', 'The provider webhook quota is full. Remove an unused subscription, then retry publication.')
    if (record(response.value) && response.value.errorCode === 'trigger_subscription_uncertain')
      throw new ConnectorTaskError(
        'connector.input-invalid',
        'Webhook creation has an uncertain outcome. Check the existing remote webhook before retrying; do not create another event source.',
      )
    if (request.operation === 'sourceReference' && response.status === 409 && record(response.value) && response.value.errorCode === 'invalid_input')
      throw new ConnectorTaskError('connector.input-invalid', 'The Source changed. Refresh its configuration before retrying.', 409)
    if (record(response.value) && ['invalid_input', 'trigger_not_found'].includes(String(response.value.errorCode)) && response.status != 409)
      throw new ConnectorTaskError('connector.input-invalid', 'The Trigger operation configuration is invalid.')
    if (
      record(response.value) &&
      ['policy_denied', 'trigger_not_allowed', 'trigger_blocked', 'trigger_owner_required'].includes(String(response.value.errorCode))
    )
      throw accessInvalid()
    throw unavailable('The Trigger operation could not be completed.')
  }

  async proxy(
    provider: string,
    connectionId: string,
    rateLimitId: string,
    request: ConnectorProxyRequest,
    signal: AbortSignal,
    access?: ConnectorClientAccess,
  ): Promise<ConnectorProxyResult> {
    if (
      typeof access == 'object' &&
      access.scope != 'catalog' &&
      (access.scope != 'proxy' || access.providerId != provider || access.connectionId != connectionId)
    )
      throw accessInvalid()
    const teamId = connectorTeamId(access)
    const bindings = await this.#providerAccessBindings(access, provider, signal, true)
    if (bindings != null && !bindings.some((candidate) => candidate.appId == connectionId && providerAccessAllowsProxy(candidate))) throw accessInvalid()
    await this.#assertConnection(connectionId, provider, signal, teamId)
    const proxyResponse = await this.#transport.request(
      'proxy.execute',
      `v1/proxy/${encodeURIComponent(provider)}`,
      {
        body: JSON.stringify(request),
        headers: {
          'content-type': 'application/json',
          'x-oo-connector-app-id': connectionId,
          'x-oomol-rate-limit-id': rateLimitId,
        },
        method: 'POST',
      },
      signal,
      { fields: { connectionId, provider, rateLimitId }, teamId },
    )
    const response = proxyResponse.value
    if (!record(response)) throw unavailable()
    if (proxyResponse.ok && response.success === true && record(response.data)) {
      const status = response.data.status
      if (Number.isSafeInteger(status) && Number(status) >= 100 && Number(status) <= 599 && Object.hasOwn(response.data, 'data')) {
        return { data: response.data.data, status: Number(status) }
      }
    }
    if (response.errorCode === 'credential_expired' || response.errorCode === 'connection_not_allowed' || response.errorCode === 'connection_not_found')
      throw connectionRequired()
    const details = connectorFailureDetails(response, this.#token)
    throw unavailable(
      `Connector proxy request failed (HTTP ${proxyResponse.status})${details.upstreamErrorCode ? ` [${details.upstreamErrorCode}]` : ''}${details.upstreamErrorMessage ? `: ${details.upstreamErrorMessage}` : '.'}`,
    )
  }

  async #accessBindings(
    access: ConnectorClientAccess | undefined,
    signal?: AbortSignal,
    connections?: readonly ConnectorConnection[],
  ): Promise<readonly ResolvedProviderAccessBinding[] | null> {
    if (!selectableAccess(access)) return null
    if (access.scope == 'catalog') {
      const available = connections ?? (await this.#connections(undefined, signal, access.teamId))
      return this.#nodeAccessBindings(access, [...new Set(available.map((connection) => connection.serviceId))], signal, available)
    }
    const bindings = selectedGrants(access)
    if (access.teamId == null) throw accessInvalid()
    return this.#resolveAccessBindings(access.teamId, bindings, signal, connections)
  }

  async #visibleConnections(
    access: Extract<ConnectorAccessContext, { readonly scope: 'catalog' }>,
    connections: readonly ConnectorConnection[],
    signal?: AbortSignal,
  ): Promise<readonly ConnectorConnection[]> {
    const { teamId } = access
    if (teamId == null) throw accessInvalid()
    const providerIds = [...new Set(connections.map((connection) => connection.serviceId))]
    if (providerIds.length == 0) return []
    const context = await this.#providerAccessContext(teamId, providerIds, signal, connections)
    try {
      const visible = await Promise.all(providerIds.map((providerId) => providerAccessConnections({ ...context, providerId, teamId })))
      const allowed = new Set(visible.flat().map((connection) => connection.connectionId))
      return connections.filter((connection) => allowed.has(connection.connectionId))
    } catch (error) {
      signal?.throwIfAborted()
      if (error instanceof TypeError) throw unavailable('Connector Connection access could not be loaded.')
      throw error
    }
  }

  async #providerAccessBindings(
    access: ConnectorClientAccess | undefined,
    providerId: string,
    signal?: AbortSignal,
    required = false,
  ): Promise<readonly ResolvedProviderAccessBinding[] | null> {
    if (!selectableAccess(access)) return null
    if (access.scope == 'catalog') {
      const bindings = await this.#nodeAccessBindings(access, [providerId], signal)
      if (bindings.length == 0 && required) {
        const providers = await this.#providers(signal, access.teamId)
        if (providers.some((provider) => provider.serviceId == providerId && provider.noSetup)) return null
        throw accessRequired()
      }
      return bindings
    }
    const selected = selectedGrants(access).filter((binding) => binding.providerId == providerId)
    if (selected.length == 0) {
      if ((await this.#providers(signal, access.teamId)).some((provider) => provider.serviceId == providerId && provider.noSetup)) return null
      if (required) throw accessRequired()
      return []
    }
    if (access.teamId == null) throw accessInvalid()
    return this.#resolveAccessBindings(access.teamId, selected, signal)
  }

  async #nodeAccessBindings(
    access: ConnectorAccessContext,
    providerIds: readonly string[],
    signal?: AbortSignal,
    connections?: readonly ConnectorConnection[],
  ): Promise<readonly ResolvedProviderAccessBinding[]> {
    if (access.teamId == null) throw accessInvalid()
    if (providerIds.length == 0) return []
    const response = await this.listProviderAccessBindingCandidates(access.teamId, providerIds, signal)
    const candidates = response.results.flatMap((result) => {
      if ('error' in result) throw new ConnectorTaskError(result.error.code, result.error.message)
      return result.candidates
    })
    return this.#resolveAccessBindings(access.teamId, candidates, signal, connections)
  }

  async #resolveAccessBindings(
    teamId: string,
    bindings: readonly ProviderAccessReference[],
    signal?: AbortSignal,
    connections?: readonly ConnectorConnection[],
  ): Promise<readonly ResolvedProviderAccessBinding[]> {
    if (bindings.length == 0) return []
    const policy = bindings.some((binding) => binding.source?.kind == 'policy') ? this.#readTeamAppAccess(teamId, signal) : Promise.resolve({ policy: {} })
    const requests = new Map<string, Promise<readonly ConnectorConnection[]>>()
    const resolved = await Promise.all(
      bindings.map(async (binding) => {
        const { providerId } = binding
        let request = requests.get(providerId)
        if (request == null) {
          request = connections == null ? this.#connections(providerId, signal, teamId) : Promise.resolve(connections)
          requests.set(providerId, request)
        }
        const [available, access] = await Promise.all([request, policy])
        return resolveProviderAccessBinding({ ...binding, teamId, connections: available, ...access })
      }),
    )
    if (resolved.some((binding) => binding == null)) throw accessInvalid()
    return resolved.filter((binding): binding is ResolvedProviderAccessBinding => binding != null)
  }

  async #actions(
    path: string,
    search: boolean,
    signal?: AbortSignal,
    teamId?: string,
    fields: Readonly<Record<string, string>> = {},
    budget?: ResponseBudget,
    locale?: string,
  ): Promise<readonly RuntimeAction[]> {
    return this.#transport.get(
      search ? 'actions.search' : 'actions.list',
      path,
      (data) => runtimeList(runtimeData(data), (value) => runtimeAction(value, search)),
      signal,
      { budget, fields, maximumResponseBytes: search ? maxResponseBytes : maxActionCatalogBytes, locale, teamId },
    )
  }

  async #connections(serviceId?: string, signal?: AbortSignal, teamId?: string): Promise<readonly ConnectorConnection[]> {
    const path = serviceId == null ? 'v1/apps' : `v1/apps/services/${encodeURIComponent(serviceId)}`
    return this.#transport.get(
      'connections.list',
      path,
      (data) => {
        const connections = runtimeList(runtimeData(data), runtimeConnection)
        if (serviceId != null && connections.some((connection) => connection.serviceId != serviceId)) throw unavailable()
        return connections
      },
      signal,
      { fields: serviceId == null ? {} : { serviceId }, teamId },
    )
  }

  async #assertConnection(connectionId: string, service: string, signal: AbortSignal, teamId?: string): Promise<void> {
    const fields = { connectionId, provider: service }
    const apps = await this.#transport.get(
      'connection.resolve',
      'v1/apps',
      (data) => {
        const values = runtimeData(data)
        if (!Array.isArray(values)) throw unavailable()
        return values as unknown[]
      },
      signal,
      { fields, teamId },
    )
    const connection = apps.find((value) => record(value) && value.id === connectionId)
    if (!record(connection) || connection.status !== 'active' || connection.service !== service) {
      this.#logger.warn({ category: 'connector.connection.unavailable', ...fields }, 'Connector Connection is unavailable.')
      throw connectionRequired()
    }
  }
}

function selectableAccess(access: ConnectorClientAccess | undefined): access is ConnectorAccessContext {
  return typeof access == 'object' && access.providerAccess.mode == 'selectable'
}

function actionFailure(response: Record<string, unknown>): ConnectorTaskError {
  if (response.success !== false || response.errorCode != 'invalid_input') return unavailable()
  const details = (Array.isArray(response.data) ? response.data : [])
    .flatMap((value) => {
      const item = record(value) ? value : undefined
      return typeof item?.error == 'string' && item.error.length > 0 ? [item.error.slice(0, 300)] : []
    })
    .slice(0, 8)
  const message = details.length == 0 ? 'The Connector Action input is invalid.' : `The Connector Action input is invalid. ${details.join(' ')}`
  return new ConnectorTaskError('connector.input-invalid', message)
}

function accessRequired(): ConnectorTaskError {
  return new ConnectorTaskError('connector.access-required', 'This Flow has no Provider access binding for the requested Connector.')
}

function actionNotFound(): ConnectorTaskError {
  return new ConnectorTaskError('connector.action-not-found', 'The Connector Action was not found.')
}
