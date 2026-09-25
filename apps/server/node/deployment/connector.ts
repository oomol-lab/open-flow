import type { ConnectorProxyRequest, ConnectorProxyResult } from '@oomol-lab/open-flow/connector-proxy'
import type { ProviderAccessReference, ConnectorAccessCandidates } from '@oomol-lab/open-flow/control-api'
import type {
  ConnectorAccess,
  ConnectorAccessSnapshot,
  ConnectorAccessGrant,
  ConnectorActionMetadata,
  ConnectorConnection,
  ConnectorProvider,
} from '@oomol-lab/open-flow/control-api'
import type { ConnectorActionCapability, ConnectorCapability, JsonValue } from '@oomol-lab/open-flow/flow-change'
import type { Logger } from 'pino'
import type { ResolvedProviderAccessBinding, TeamAppAccess } from './provider-access.ts'

import { connectorActionPorts } from '@oomol-lab/open-flow/connector-action'
import { providerIconAppearance } from '@oomol-lab/open-flow/control-api'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import { errorKind, silentLogger } from '../logger.ts'
import { providerAccessAllowsAction, providerAccessAllowsProxy, providerAccessBindingCandidates, resolveProviderAccessBinding } from './provider-access.ts'

const maxResponseBytes = 1024 * 1024
const maxActionResponseBytes = 32 * 1024 * 1024
const maxActionCatalogBytes = 8 * 1024 * 1024
const catalogConcurrency = 16
const readinessTimeoutMs = 1_000
const hostedAccessFreshMs = 5 * 60 * 1_000
const responseDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })

interface ResponseBudget {
  readonly exhaust: (responseBytes: number) => ConnectorTaskError
  readonly limit: number
  used: number
}
interface GetOptions {
  readonly fields?: Readonly<Record<string, string>>
  readonly teamId?: string
  readonly locale?: string
  readonly budget?: ResponseBudget
  readonly maximumResponseBytes?: number
  readonly failure?: (data: unknown) => ConnectorTaskError
}

interface RuntimeAction {
  readonly operationType?: string
  readonly description: string
  readonly id: string
  readonly inputSchema: JsonValue
  readonly name: string
  readonly outputSchema: JsonValue
  readonly service: string
}

export interface ConnectorHost {
  execute(
    action: string,
    connectionId: string | undefined,
    input: Readonly<Record<string, JsonValue>>,
    invocationId: string,
    signal: AbortSignal,
    access?: ConnectorAccessContext,
  ): Promise<JsonValue>
  getAction(actionId: string, signal?: AbortSignal, access?: ConnectorAccessContext, locale?: string): Promise<ConnectorActionMetadata>
  listActions(serviceId?: string, signal?: AbortSignal, access?: ConnectorAccessContext, locale?: string): Promise<readonly ConnectorActionMetadata[]>
  listAllConnections(signal?: AbortSignal, access?: ConnectorAccessContext): Promise<readonly ConnectorConnection[]>
  listConnections(serviceId: string, signal?: AbortSignal, access?: ConnectorAccessContext): Promise<readonly ConnectorConnection[]>
  listProviders(signal?: AbortSignal, access?: ConnectorAccessContext, locale?: string): Promise<readonly ConnectorProvider[]>
  proxy(
    provider: string,
    connectionId: string,
    rateLimitId: string,
    request: ConnectorProxyRequest,
    signal: AbortSignal,
    access?: ConnectorAccessContext,
  ): Promise<ConnectorProxyResult>
  ready(): Promise<boolean>
  searchActions(query: string, signal?: AbortSignal, access?: ConnectorAccessContext, locale?: string): Promise<readonly ConnectorActionMetadata[]>
}

interface ConnectorContext {
  readonly actorId?: string
  readonly flowId?: string
  readonly providerId?: string
  readonly purpose: 'catalog' | 'eligibility' | 'execute' | 'proxy' | 'trigger'
  readonly source: 'operator' | 'draft' | 'publication' | 'run'
  readonly teamId?: string
}

export type ConnectorAccessContext = ConnectorContext &
  (
    | { readonly scope: 'catalog'; readonly providerAccess: ConnectorAccess }
    | { readonly scope: 'shared' | 'selected'; readonly providerAccess: ConnectorAccessSnapshot }
    | { readonly scope: 'action'; readonly providerAccess: ConnectorAccessSnapshot; readonly action: string; readonly connectionId?: string }
    | { readonly scope: 'proxy'; readonly providerAccess: ConnectorAccessSnapshot; readonly providerId: string; readonly connectionId: string }
  )

function selectedGrants(access: Exclude<ConnectorAccessContext, { readonly scope: 'catalog' }>): readonly ConnectorAccessGrant[] {
  switch (access.scope) {
    case 'shared':
      return access.providerAccess.sharedBindings
    case 'selected':
      return access.providerAccess.selectedBindings
    case 'action':
    case 'proxy':
      return access.providerAccess.selectedBindings.filter((binding) => binding.connectionId == access.connectionId)
  }
}

type ConnectorClientAccess = ConnectorAccessContext | string

function connectorTeamId(access: ConnectorClientAccess | undefined): string | undefined {
  return typeof access == 'string' ? access : access?.teamId
}

export type ConnectorErrorCode =
  | 'connector.access-invalid'
  | 'connector.access-required'
  | 'connector.input-invalid'
  | 'connector.indeterminate'
  | 'connector.action-not-found'
  | 'connector.connection-required'
  | 'connector.unavailable'
  | 'connector.unconfigured'

export class ConnectorTaskError extends Error {
  readonly code: ConnectorErrorCode

  constructor(code: ConnectorErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'ConnectorTaskError'
  }
}

class RequestError extends ConnectorTaskError {
  readonly reason: string
  readonly status: number | undefined

  constructor(cause: ConnectorTaskError, reason: string, status: number | undefined) {
    super(cause.code, cause.message)
    this.cause = cause
    this.reason = reason
    this.status = status
  }
}

export class ConnectorClient implements ConnectorHost {
  readonly #apiOrigin?: URL
  readonly #logger: Logger
  readonly #origin: URL
  readonly #teamOrigin?: URL
  readonly #timeoutMs: number
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
    this.#timeoutMs = timeoutMs
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
    const response = await this.#request('teams.list', 'v1/me/teams', { method: 'GET' }, signal, { origin: this.#teamOrigin })
    if (!response.ok) throw unavailable()
    return this.#decode('teams.list', {}, () => {
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
    if (this.#teamOrigin == null || this.#token.length == 0) throw unavailable()
    const response = await this.#request('teams.membership', 'v1/me/teams', { method: 'GET' }, signal, { origin: this.#teamOrigin })
    if (!response.ok || !record(response.value) || !Array.isArray(response.value.teams)) throw unavailable('The OOMOL Team membership could not be loaded.')
    const team = response.value.teams.find((entry: unknown) => record(entry) && entry.id == teamId)
    if (!record(team) || team.deleted !== false || team.status != 'normal') throw accessInvalid()
    if (team.role != 'creator' && team.role != 'admin' && team.role != 'member') throw accessInvalid()
    const teamAdmin = team.role == 'creator' || team.role == 'admin'
    const [actorId, connections, access] = await Promise.all([
      teamAdmin ? Promise.resolve('') : this.#oomolUserId(signal),
      this.#connections(providerIds.length == 1 ? providerIds[0] : undefined, signal, teamId),
      teamAdmin ? Promise.resolve({ policy: {} }) : this.#readTeamAppAccess(teamId, signal),
    ])
    const results = await Promise.all(
      providerIds.map(async (providerId) => {
        signal?.throwIfAborted()
        try {
          const candidates = await providerAccessBindingCandidates({ actorId, connections, ...access, providerId, teamId, teamAdmin })
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

  async #oomolUserId(signal?: AbortSignal): Promise<string> {
    if (this.#apiOrigin == null || this.#token.length == 0) throw unavailable()
    if (this.#userId != null) return this.#userId
    const response = await this.#request('user.profile', 'v1/users/profile', { method: 'GET' }, signal, { origin: this.#apiOrigin })
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
    const response = await this.#request('team.app-access', `v1/teams/${encodeURIComponent(teamId)}/app-access`, { method: 'GET' }, signal, {
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
    return this.#get(
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
      const mapped = this.#decode('actions.list', { serviceId }, () => mapActions(actions, providers))
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
        const mapped = this.#decode('actions.list', {}, () => mapActions(catalogs.flat(), providers))
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
    const mapped = this.#decode('actions.search', {}, () => mapActions(actions, providers))
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
      this.#get('actions.get', `v1/actions/${encodeURIComponent(actionId)}`, (data) => runtimeAction(runtimeData(data)), signal, {
        fields: { actionId },
        teamId,
        locale,
        failure: (data) => (record(data) && data.success === false && data.errorCode === 'unknown_action' ? actionNotFound() : unavailable()),
      }),
    ])
    const mapped = this.#decode('actions.get', { actionId }, () => mapAction(action, providers))
    if (bindings != null && !bindings.some((binding) => providerAccessAllowsAction(binding, mapped))) throw accessInvalid()
    return mapped
  }

  async listAllConnections(signal?: AbortSignal, access?: ConnectorClientAccess): Promise<readonly ConnectorConnection[]> {
    const connections = await this.#connections(undefined, signal, connectorTeamId(access))
    const bindings = await this.#accessBindings(access, signal, connections)
    if (bindings == null) return connections
    const allowed = new Set(bindings.map((binding) => binding.appId))
    return connections.filter((connection) => allowed.has(connection.connectionId))
  }

  async listConnections(serviceId: string, signal?: AbortSignal, access?: ConnectorClientAccess): Promise<readonly ConnectorConnection[]> {
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

    const actionResponse = await this.#request(
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
    ).catch((error: unknown) => {
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
    if (response.errorCode === 'connection_not_allowed' || response.errorCode === 'connection_not_found') throw connectionRequired()
    const failure = actionFailure(response)
    if (failure.code == 'connector.input-invalid') throw failure
    throw new ConnectorTaskError(
      'connector.indeterminate',
      `Connector ${response.success === false ? 'reported an action failure' : 'returned an unexpected action response'} (HTTP ${actionResponse.status}). The action outcome is unknown.`,
    )
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
      throw accessInvalid('The proxy request is outside this invocation’s access scope.')
    const teamId = connectorTeamId(access)
    const bindings = await this.#providerAccessBindings(access, provider, signal, true)
    if (bindings != null) {
      const binding = bindings.find((candidate) => candidate.appId == connectionId && providerAccessAllowsProxy(candidate))
      if (binding == null) throw accessInvalid()
    }
    await this.#assertConnection(connectionId, provider, signal, teamId)
    const proxyResponse = await this.#request(
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
    if (response.errorCode === 'connection_not_allowed' || response.errorCode === 'connection_not_found') throw connectionRequired()
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
    return this.#get(
      search ? 'actions.search' : 'actions.list',
      path,
      (data) => runtimeList(runtimeData(data), (value) => runtimeAction(value, search)),
      signal,
      { budget, fields, maximumResponseBytes: search ? maxResponseBytes : maxActionCatalogBytes, locale, teamId },
    )
  }

  async #connections(serviceId?: string, signal?: AbortSignal, teamId?: string): Promise<readonly ConnectorConnection[]> {
    const path = serviceId == null ? 'v1/apps' : `v1/apps/services/${encodeURIComponent(serviceId)}`
    return this.#get(
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

  async #get<Value>(operation: string, path: string, decode: (data: unknown) => Value, signal?: AbortSignal, options: GetOptions = {}): Promise<Value> {
    signal?.throwIfAborted()
    const response = await this.#request(operation, path, { method: 'GET' }, signal, options)
    if (!response.ok) throw options.failure?.(response.value) ?? unavailable()
    signal?.throwIfAborted()
    return this.#decode(operation, options.fields ?? {}, () => decode(response.value))
  }

  #decode<Value>(operation: string, fields: Readonly<Record<string, string>>, decode: () => Value): Value {
    try {
      return decode()
    } catch (error) {
      this.#logger.warn(
        {
          category: 'connector.request.failed',
          errorMessage: error instanceof Error ? error.message : String(error),
          failure: 'response-invalid',
          operation,
          ...fields,
          ...errorKind(error),
        },
        'Connector response was invalid.',
      )
      if (error instanceof ConnectorTaskError) throw error
      throw unavailable()
    }
  }

  async #assertConnection(connectionId: string, service: string, signal: AbortSignal, teamId?: string): Promise<void> {
    const fields = { connectionId, provider: service }
    const apps = await this.#get(
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

  async #request(
    operation: string,
    path: string,
    init: RequestInit,
    signal?: AbortSignal,
    {
      budget,
      fields = {},
      maximumResponseBytes = maxResponseBytes,
      origin = this.#origin,
      teamId,
      locale,
    }: {
      readonly budget?: ResponseBudget
      readonly fields?: Readonly<Record<string, string>>
      readonly maximumResponseBytes?: number
      readonly locale?: string
      readonly origin?: URL
      readonly teamId?: string
    } = {},
  ): Promise<{ readonly headers: Headers; readonly ok: boolean; readonly status: number; readonly value: unknown }> {
    const startedAt = performance.now()
    const timeout = AbortSignal.timeout(this.#timeoutMs)
    let status: number | undefined
    try {
      const response = await fetch(new URL(path, origin), {
        ...init,
        headers: {
          ...(this.#token == '' ? {} : { authorization: `Bearer ${this.#token}` }),
          ...(origin == this.#origin && teamId != null ? { 'x-oo-team-id': teamId } : {}),
          ...(locale == null ? {} : { 'Accept-Language': locale }),
          ...init.headers,
        },
        redirect: 'error',
        signal: signal == null ? timeout : AbortSignal.any([signal, timeout]),
      })
      status = response.status
      const value = await readJson(response, maximumResponseBytes, budget)
      if (!response.ok) {
        this.#logger.warn(
          {
            category: 'connector.request.failed',
            durationMs: Math.round(performance.now() - startedAt),
            failure: 'upstream-status',
            ...connectorFailureDetails(value, this.#token),
            method: init.method ?? 'GET',
            operation,
            status,
            ...fields,
          },
          'Connector request failed.',
        )
      }
      return { headers: response.headers, ok: response.ok, status: response.status, value }
    } catch (error) {
      if (signal?.aborted) throw signal.reason
      let failure = 'transport'
      if (error instanceof ConnectorTaskError) failure = 'response-invalid'
      else if (timeout.aborted) failure = 'timeout'
      this.#logger.warn(
        {
          category: 'connector.request.failed',
          durationMs: Math.round(performance.now() - startedAt),
          failure,
          errorMessage: error instanceof Error ? error.message : String(error),
          method: init.method ?? 'GET',
          operation,
          ...(status == null ? {} : { status }),
          ...fields,
          ...errorKind(error),
        },
        'Connector request failed.',
      )
      let reason = 'Connector connection failed while sending the request or receiving its response'
      if (failure == 'timeout') reason = `Connector request timed out after ${this.#timeoutMs} ms`
      else if (error instanceof ConnectorTaskError) reason = error.message
      throw new RequestError(error instanceof ConnectorTaskError ? error : unavailable(), reason, status)
    }
  }
}

function connectionRequired(): ConnectorTaskError {
  return new ConnectorTaskError('connector.connection-required', 'The selected Connector Connection must be reconnected or replaced.')
}

function accessRequired(): ConnectorTaskError {
  return new ConnectorTaskError('connector.access-required', 'This Flow has no Provider access binding for the requested Connector.')
}

function accessInvalid(message = 'The Flow Provider access binding is no longer valid.'): ConnectorTaskError {
  return new ConnectorTaskError('connector.access-invalid', message)
}

function selectableAccess(access: ConnectorClientAccess | undefined): access is ConnectorAccessContext {
  return typeof access == 'object' && access.providerAccess.mode == 'selectable'
}

function actionNotFound(): ConnectorTaskError {
  return new ConnectorTaskError('connector.action-not-found', 'The Connector Action was not found.')
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

function connectorFailureDetails(value: unknown, token: string): { upstreamErrorCode?: string; upstreamErrorMessage?: string } {
  if (!record(value)) return {}
  const sanitize = (text: string): string => {
    const masked = token == '' ? text : text.replaceAll(token, '[Redacted]')
    if (/(?:authorization|cookie|credential|password|(?:access|refresh|api)[_-]?(?:token|key))\s*["']?\s*[:=]|bearer\s+\S+/i.test(masked)) return '[Redacted]'
    return masked.slice(0, 1_000)
  }
  return {
    ...(typeof value.errorCode == 'string' ? { upstreamErrorCode: sanitize(value.errorCode) } : {}),
    ...(typeof value.message == 'string' ? { upstreamErrorMessage: sanitize(value.message) } : {}),
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value == 'object' && !Array.isArray(value)
}

async function readJson(response: Response, limit: number, budget?: ResponseBudget): Promise<unknown> {
  if (response.body == null) throw unavailable('Connector response has no body')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (budget != null) {
        const responseBytes = budget.used + value.byteLength
        if (responseBytes > budget.limit) throw budget.exhaust(responseBytes)
        budget.used = responseBytes
      }
      bytes += value.byteLength
      if (bytes > limit) {
        await reader.cancel()
        throw unavailable(`Connector response exceeds the ${limit}-byte size limit`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  try {
    return JSON.parse(responseDecoder.decode(Buffer.concat(chunks, bytes))) as unknown
  } catch {
    throw unavailable('Connector response is not valid JSON')
  }
}

function string(value: unknown, field: string): string {
  if (typeof value != 'string' || value.length == 0) throw unavailable(`Connector response field "${field}" must be a non-empty string.`)
  return value
}

function runtimeData(value: unknown): unknown {
  const source = record(value) ? value : undefined
  if (source == null || source.success !== true || !Object.hasOwn(source, 'data')) {
    throw unavailable('Connector response must contain successful data.')
  }
  return source.data
}

function runtimeList<Value>(value: unknown, decode: (value: unknown) => Value): readonly Value[] {
  if (!Array.isArray(value)) throw unavailable('Connector response data must be an array.')
  return value.map(decode)
}

function runtimeProvider(value: unknown, metadata?: unknown) {
  const source = record(value) ? value : undefined
  if (source == null) throw unavailable('Connector Provider must be an object.')
  if (!Array.isArray(source.authTypes) || source.authTypes.some((authType) => typeof authType != 'string')) {
    throw unavailable('Connector Provider authTypes must be an array of strings.')
  }
  if (source.homepageUrl != null && typeof source.homepageUrl != 'string') throw unavailable('Connector Provider homepageUrl must be a string.')
  if (source.iconUrl != null && typeof source.iconUrl != 'string') throw unavailable('Connector Provider iconUrl must be a string.')
  return {
    ...providerIconAppearance(metadata, source.iconSpritePosition),
    authenticated: !source.authTypes.includes('no_auth'),
    noSetup: source.authTypes.length == 1 && source.authTypes[0] == 'no_auth',
    ...(source.homepageUrl == null || source.homepageUrl.length == 0 ? {} : { homepageUrl: source.homepageUrl }),
    ...(source.iconUrl == null || source.iconUrl.length == 0 ? {} : { icon: source.iconUrl }),
    serviceId: string(source.service, 'provider.service'),
    serviceName: string(source.displayName, 'provider.displayName'),
  }
}

function runtimeAction(value: unknown, search = false): RuntimeAction {
  const source = record(value) ? value : undefined
  if (source == null) throw unavailable('Connector Action must be an object.')
  if (typeof source.description != 'string') throw unavailable('Connector Action description must be a string.')
  const name = string(source.name, 'action.name')
  const service = string(source.service, 'action.service')
  return {
    ...(source.operationType == null ? {} : { operationType: string(source.operationType, 'action.operationType') }),
    description: source.description,
    id: search ? `${service}.${name}` : string(source.id, 'action.id'),
    inputSchema: source.inputSchema as JsonValue,
    name,
    outputSchema: source.outputSchema as JsonValue,
    service,
  }
}

function runtimeConnection(value: unknown): ConnectorConnection {
  const source = record(value) ? value : undefined
  if (source == null) throw unavailable('Connector Connection must be an object.')
  const status = connectionStatus(source.status)
  if (typeof source.isDefault != 'boolean') throw unavailable('Connector Connection isDefault must be a boolean.')
  return {
    ...(source.providerAccountId == null ? {} : { providerAccountId: string(source.providerAccountId, 'connection.providerAccountId') }),
    ...(source.alias == null ? {} : { alias: string(source.alias, 'connection.alias') }),
    ...(source.marketplace == null ? {} : { builtInAccount: true }),
    connectionId: string(source.id, 'connection.id'),
    displayName: string(source.displayName, 'connection.displayName'),
    isDefault: source.isDefault,
    serviceId: string(source.service, 'connection.service'),
    status,
  }
}

function runtimeTeam(value: unknown): { readonly id: string; readonly name: string; readonly systemCreated: boolean } {
  if (!record(value)) throw unavailable('Connector Team must be an object.')
  return {
    id: string(value.id, 'team.id'),
    name: string(value.name, 'team.name'),
    systemCreated: value.system_created === true,
  }
}

function connectionStatus(value: unknown): 'active' | 'disconnected' {
  switch (value) {
    case 'active':
      return 'active'
    case 'disconnected':
      return 'disconnected'
    default:
      throw unavailable('Connector Connection status was invalid.')
  }
}

function mapActions(actions: readonly RuntimeAction[], providers: readonly ReturnType<typeof runtimeProvider>[]): readonly ConnectorActionMetadata[] {
  return actions.map((action) => mapAction(action, providers))
}

function mapAction(action: RuntimeAction, providers: readonly ReturnType<typeof runtimeProvider>[]): ConnectorActionMetadata {
  const provider = providers.find((candidate) => candidate.serviceId == action.service)
  if (provider == null) throw unavailable('Connector Action referenced an unknown service.')
  let ports: ReturnType<typeof connectorActionPorts>
  try {
    ports = connectorActionPorts(action.inputSchema, action.outputSchema)
  } catch {
    throw unavailable('Connector response is not valid JSON')
  }
  return {
    actionId: action.id,
    ...(action.operationType == null ? {} : { operationType: action.operationType }),
    inputSchema: action.inputSchema,
    outputSchema: action.outputSchema,
    authenticated: provider.authenticated,
    description: action.description,
    ...(provider.homepageUrl == null ? {} : { homepageUrl: provider.homepageUrl }),
    ...(provider.icon == null ? {} : { icon: provider.icon }),
    ...(provider.iconSprite == null ? {} : { iconSprite: provider.iconSprite, iconSpritePosition: provider.iconSpritePosition }),
    inputs: Object.fromEntries(
      ports.inputs.map((port) => {
        if (port.nullable == null) throw unavailable('Connector Action input schema did not declare nullability.')
        return [
          port.handle,
          {
            ...(port.description == null ? {} : { description: port.description }),
            jsonSchema: port.json_schema as JsonValue,
            nullable: port.nullable,
            ...(port.value === undefined ? {} : { value: port.value as JsonValue }),
          },
        ]
      }),
    ),
    name: action.name,
    outputs: Object.fromEntries(
      ports.outputs.map((port) => {
        if (port.nullable == null) throw unavailable('Connector Action output schema did not declare nullability.')
        return [
          port.handle,
          {
            ...(port.description == null ? {} : { description: port.description }),
            jsonSchema: port.json_schema as JsonValue,
            nullable: port.nullable,
          },
        ]
      }),
    ),
    serviceId: action.service,
    serviceName: provider.serviceName,
  }
}

function unavailable(message = 'The Connector request could not be completed.'): ConnectorTaskError {
  return new ConnectorTaskError('connector.unavailable', message)
}

export async function checkCodeActions(
  declarations: readonly ConnectorActionCapability[],
  connector: ConnectorHost | undefined,
  access?: ConnectorAccessContext,
  signal?: AbortSignal,
): Promise<void> {
  if (declarations.length == 0) return
  if (connector == null) throw new ConnectorTaskError('connector.unconfigured', 'Connector is not configured for this deployment.')
  const actions = new Map<string, Promise<ConnectorActionMetadata>>()
  const catalogs = new Map<string, Promise<readonly ConnectorConnection[]>>()
  for (const declaration of declarations) {
    let action = actions.get(declaration.action)
    if (action == null) {
      action = connector.getAction(declaration.action, signal, access)
      actions.set(declaration.action, action)
    }
    const definition = await action
    if (definition.authenticated && declaration.connections.length == 0) throw connectionRequired()
    if (declaration.connections.length == 0) continue
    let catalog = catalogs.get(definition.serviceId)
    if (catalog == null) {
      catalog = connector.listConnections(definition.serviceId, signal, access)
      catalogs.set(definition.serviceId, catalog)
    }
    const connections = await catalog
    for (const allowed of declaration.connections) {
      if (
        !connections.some(
          (connection) => connection.connectionId == allowed.connectionId && connection.serviceId == definition.serviceId && connection.status == 'active',
        )
      )
        throw connectionRequired()
    }
  }
}

export async function checkCodePermissions(
  declarations: readonly ConnectorCapability[],
  connector: ConnectorHost | undefined,
  access: ConnectorAccessContext,
  signal?: AbortSignal,
): Promise<void> {
  const permissions = declarations.filter((declaration) => 'mode' in declaration && declaration.mode == 'independent')
  if (permissions.every((declaration) => declaration.actions.length == 0)) return
  if (connector == null) throw new ConnectorTaskError('connector.unconfigured', 'Connector is not configured for this deployment.')
  for (const permission of permissions) {
    for (const entry of permission.actions) {
      if (access.scope == 'catalog') throw accessInvalid('Code permissions require a fixed access snapshot.')
      const scoped: ConnectorAccessContext = { ...access, scope: 'action', action: entry.action, connectionId: entry.connectionId }
      const action = await connector.getAction(entry.action, signal, { ...scoped, providerId: entry.action.split('.')[0] })
      if (!action.authenticated && entry.connectionId == null) continue
      if (entry.connectionId == null) throw connectionRequired()
      const connections = await connector.listConnections(action.serviceId, signal, scoped)
      if (!connections.some((connection) => connection.status == 'active' && connection.connectionId == entry.connectionId)) throw connectionRequired()
    }
  }
}
