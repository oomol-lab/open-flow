import type { Logger } from 'pino'
import type { ServiceMode, ServiceProfile } from '../storage/settings-store.ts'
import type { LlmConfig, LlmHost } from './llm.ts'

import { validateServiceProfile } from '../../common/service-profile.ts'
import { silentLogger } from '../logger.ts'
import { SettingsStore } from '../storage/settings-store.ts'
import { ConnectorClient } from './connector.ts'
import { createLlm, oomolLlmConfig } from './llm.ts'

export class Settings {
  readonly #connectorConsoleOrigin?: string
  readonly #connectorOrigin?: string
  readonly #connectorToken?: string
  readonly #environmentConnector?: ConnectorClient
  readonly #environmentIntegration?: { readonly callbackKey: string; readonly publicOrigin: string }
  readonly #environmentLlm?: ReturnType<typeof createLlm>
  readonly #logger: Logger
  readonly #store: SettingsStore
  #connectorCache?: { readonly client: ConnectorClient; readonly origin: string; readonly token: string }

  constructor(
    store: SettingsStore,
    environment: {
      readonly connectorConsoleOrigin?: string
      readonly connectorOrigin?: string
      readonly connectorToken?: string
      readonly integrationCallbackKey?: string
      readonly integrationPublicOrigin?: string
      readonly llmOrigin?: string
      readonly llmToken?: string
      readonly logger?: Logger
    },
  ) {
    this.#store = store
    this.#logger = environment.logger ?? silentLogger
    this.#connectorOrigin = environment.connectorOrigin
    this.#connectorToken = environment.connectorToken
    this.#connectorConsoleOrigin = environment.connectorConsoleOrigin == null ? undefined : publicOrigin(environment.connectorConsoleOrigin)
    if (environment.connectorOrigin != null) {
      this.#environmentConnector = new ConnectorClient(environment.connectorOrigin, environment.connectorToken ?? '', 30_000, this.#logger)
    }
    if (environment.integrationPublicOrigin != null && environment.integrationCallbackKey != null) {
      this.#environmentIntegration = integration(environment.integrationPublicOrigin, environment.integrationCallbackKey)
    }
    if (environment.llmOrigin != null && environment.llmToken != null) {
      this.#environmentLlm = createLlm(environment.llmOrigin, environment.llmToken)
    }
    this.#store.initializeLlmMode(this.#environmentConnector != null ? (this.oomolManaged() ? 'oomol' : 'custom') : (this.#store.state().serviceMode ?? 'none'))
  }

  connector(): ConnectorClient | undefined {
    if (this.#environmentConnector != null) return this.#environmentConnector
    const stored = this.#store.state()
    if (stored.connectorOrigin == null || stored.connectorToken == null) return undefined
    const cache = this.#connectorCache
    if (cache?.origin === stored.connectorOrigin && cache?.token === stored.connectorToken) {
      return cache.client
    }
    const client = new ConnectorClient(stored.connectorOrigin, stored.connectorToken, 30_000, this.#logger)
    this.#connectorCache = { client, origin: stored.connectorOrigin, token: stored.connectorToken }
    return client
  }

  connectorConfiguration(): { readonly origin: string; readonly token: string } | undefined {
    const { origin, token } = this.#connectorValues(this.#store.state())
    return origin == null || token == null ? undefined : { origin, token }
  }

  connectorConsoleOrigin(): URL | undefined {
    if (this.#hosted()) return undefined
    if (this.#connectorConsoleOrigin != null) return new URL(this.#connectorConsoleOrigin)
    const stored = this.#store.state()
    return stored.connectorConsoleOrigin == null ? undefined : new URL(stored.connectorConsoleOrigin)
  }

  integration(): { readonly callbackKey: string; readonly publicOrigin: string } | undefined {
    if (this.#environmentIntegration != null) return this.#environmentIntegration
    const stored = this.#store.state()
    return stored.integrationPublicOrigin == null || stored.integrationCallbackKey == null
      ? undefined
      : { callbackKey: stored.integrationCallbackKey, publicOrigin: stored.integrationPublicOrigin }
  }

  llm(): LlmHost | undefined {
    if (this.#environmentLlm != null) return this.#environmentLlm
    const { config } = this.#resolveLlm(this.#store.state())
    return config == null ? undefined : createLlm(config.origin, config.token)
  }

  oomolManaged(): boolean {
    return hostedOrigin(this.#connectorOrigin)
  }

  /** OOMOL authorization is shared, independently of the selected Connector profile. */
  #oomolConfiguration(): { readonly origin: string; readonly token: string } | undefined {
    if (this.oomolManaged()) return { origin: this.#connectorOrigin!, token: this.#connectorToken ?? '' }
    const profile = this.#store.profile('oomol')
    if (profile.connectorOrigin == null) return
    return { origin: profile.connectorOrigin, token: profile.connectorToken ?? '' }
  }

  #llmMode(stored: ReturnType<SettingsStore['state']>): ServiceMode | null {
    if (this.#environmentLlm != null) return 'custom'
    return stored.llmMode == 'oomol' || stored.llmMode == 'custom' ? stored.llmMode : this.oomolManaged() ? 'oomol' : null
  }

  #resolveLlm(stored: ReturnType<SettingsStore['state']>) {
    const mode = this.#llmMode(stored)
    const authorization = this.#oomolConfiguration()
    const oomol = oomolLlmConfig(authorization?.origin, authorization?.token)
    let config: LlmConfig | undefined
    if (this.#environmentLlm != null) config = this.#environmentLlm.config
    else if (mode == 'oomol') config = oomol
    else if (mode == 'custom' && stored.llmOrigin != null && stored.llmToken != null && stored.llmToken.trim() != '')
      config = { origin: stored.llmOrigin, token: stored.llmToken }
    return { mode, config, oomolAvailable: oomol != null }
  }

  status() {
    const stored = this.#store.state()
    const connector =
      this.#connectorOrigin != null
        ? {
            configured: true as const,
            origin: new URL(this.#connectorOrigin).origin,
            source: 'environment' as const,
            tokenConfigured: (this.#connectorToken ?? '').length > 0,
          }
        : stored.connectorOrigin != null
          ? {
              configured: true as const,
              origin: stored.connectorOrigin,
              source: 'settings' as const,
              tokenConfigured: (stored.connectorToken ?? '').length > 0,
            }
          : { configured: false as const, source: 'none' as const, tokenConfigured: false as const }
    const console = this.#hosted()
      ? { configured: false as const, source: 'none' as const }
      : this.#connectorConsoleOrigin != null
        ? { configured: true as const, origin: this.#connectorConsoleOrigin, source: 'environment' as const }
        : stored.connectorConsoleOrigin != null
          ? { configured: true as const, origin: stored.connectorConsoleOrigin, source: 'settings' as const }
          : { configured: false as const, source: 'none' as const }
    const integrationStatus =
      this.#environmentIntegration != null
        ? { configured: true as const, publicOrigin: this.#environmentIntegration.publicOrigin, source: 'environment' as const }
        : stored.integrationPublicOrigin != null
          ? { configured: true as const, publicOrigin: stored.integrationPublicOrigin, source: 'settings' as const }
          : { configured: false as const, source: 'none' as const }
    const profileStatus = (mode: ServiceMode) => {
      const profile = this.#store.profile(mode)
      return {
        connectorOrigin: profile.connectorOrigin ?? '',
        connectorTokenConfigured: !!profile.connectorToken,
        consoleOrigin: profile.consoleOrigin ?? '',
      }
    }
    const managed = this.#environmentConnector != null || this.#connectorConsoleOrigin != null
    const services = {
      profiles: { oomol: profileStatus('oomol'), custom: profileStatus('custom') },
      mode: managed ? (this.#hosted(stored) ? ('oomol' as const) : ('custom' as const)) : stored.serviceMode,
      managed,
    }
    const { mode, config: llm, oomolAvailable } = this.#resolveLlm(stored)
    return {
      services,
      connector: { console, runtime: connector },
      integration: integrationStatus,
      revision: stored.revision,
      version: 1 as const,
      llm: {
        mode,
        managed: this.#environmentLlm != null,
        custom: { origin: stored.llmOrigin ?? '', tokenConfigured: !!stored.llmToken?.trim() },
        oomolAvailable,
        oomolManaged: this.oomolManaged(),
        ...(llm == null
          ? { configured: false as const, source: 'none' as const, tokenConfigured: false as const }
          : {
              configured: true as const,
              origin: llm.origin,
              source: this.#environmentLlm != null ? ('environment' as const) : mode == 'oomol' ? ('derived' as const) : ('settings' as const),
              tokenConfigured: true as const,
            }),
      },
    }
  }

  saveProfile(
    expectedRevision: number,
    mode: ServiceMode,
    value: {
      readonly connectorOrigin: string
      readonly connectorToken: string | null
      readonly consoleOrigin: string
    },
  ): 'conflict' | 'environment' | 'saved' {
    if (mode == 'oomol' ? this.oomolManaged() : this.#environmentConnector != null || this.#connectorConsoleOrigin != null) return 'environment'
    const previous = this.#store.profile(mode)
    const connectorToken = value.connectorToken ?? previous.connectorToken ?? ''
    if (Object.values(validateServiceProfile(mode, { ...value, connectorToken })).some((issue) => issue != 'required'))
      throw new Error('Invalid service configuration.')
    if (value.connectorOrigin.trim() != '') void new ConnectorClient(value.connectorOrigin, connectorToken, 30_000, this.#logger)
    const profile: ServiceProfile = {
      connectorOrigin: value.connectorOrigin.trim() == '' ? null : new URL(value.connectorOrigin).href,
      connectorToken,
      consoleOrigin: mode == 'custom' && value.consoleOrigin != '' ? publicOrigin(value.consoleOrigin) : null,
    }
    return this.#store.putProfile(expectedRevision, mode, profile) ? 'saved' : 'conflict'
  }

  selectProfile(expectedRevision: number, mode: ServiceMode): 'conflict' | 'environment' | 'saved' {
    if (this.#environmentConnector != null || this.#connectorConsoleOrigin != null) return 'environment'
    return this.#store.selectProfile(expectedRevision, mode) ? 'saved' : 'conflict'
  }

  putServices(
    expectedRevision: number,
    value: {
      readonly connectorOrigin: string
      readonly connectorToken: string
      readonly consoleOrigin: string
      readonly llmOrigin: string
      readonly llmToken: string
    },
  ): 'conflict' | 'environment' | 'saved' {
    if (this.#environmentConnector != null || this.#environmentLlm != null || this.#connectorConsoleOrigin != null) return 'environment'
    if (hostedOrigin(value.connectorOrigin)) throw new Error('Use OOMOL authorization or an API key for hosted services.')
    void new ConnectorClient(value.connectorOrigin, value.connectorToken, 30_000, this.#logger)
    if (value.llmOrigin != '' || value.llmToken != '') createLlm(value.llmOrigin, value.llmToken)
    const normalized = {
      ...value,
      connectorOrigin: new URL(value.connectorOrigin).href,
      consoleOrigin: value.consoleOrigin == '' ? null : publicOrigin(value.consoleOrigin),
      llmOrigin: value.llmOrigin == '' ? null : new URL(value.llmOrigin).origin,
      llmToken: value.llmOrigin == '' ? null : value.llmToken,
    }
    return this.#store.putServices(expectedRevision, normalized) ? 'saved' : 'conflict'
  }

  deleteServices(expectedRevision: number): 'conflict' | 'environment' | 'saved' {
    if (this.#environmentConnector != null || this.#connectorConsoleOrigin != null) return 'environment'
    return this.#store.putProfile(expectedRevision, this.#store.state().serviceMode ?? 'custom', {
      connectorOrigin: null,
      connectorToken: null,
      consoleOrigin: null,
    })
      ? 'saved'
      : 'conflict'
  }

  #hosted(stored = this.#store.state()): boolean {
    return hostedOrigin(this.#connectorValues(stored).origin)
  }

  putConnector(expectedRevision: number, origin: string, token: string): 'conflict' | 'environment' | 'saved' {
    if (this.#environmentConnector != null) return 'environment'
    void new ConnectorClient(origin, token, 30_000, this.#logger)
    return this.#store.putConnector(expectedRevision, new URL(origin).href, token) ? 'saved' : 'conflict'
  }

  deleteConnector(expectedRevision: number): 'conflict' | 'environment' | 'saved' {
    if (this.#environmentConnector != null) return 'environment'
    if (this.#hosted()) return this.deleteServices(expectedRevision)
    return this.#store.deleteConnector(expectedRevision) ? 'saved' : 'conflict'
  }

  putConnectorConsole(expectedRevision: number, origin: string): 'conflict' | 'environment' | 'saved' {
    if (this.#connectorConsoleOrigin != null) return 'environment'
    if (this.#hosted()) throw new Error('OOMOL manages the hosted Console.')
    return this.#store.putConnectorConsole(expectedRevision, publicOrigin(origin)) ? 'saved' : 'conflict'
  }

  deleteConnectorConsole(expectedRevision: number): 'conflict' | 'environment' | 'saved' {
    if (this.#connectorConsoleOrigin != null) return 'environment'
    return this.#store.deleteConnectorConsole(expectedRevision) ? 'saved' : 'conflict'
  }

  putIntegration(expectedRevision: number, origin: string, callbackKey: string): 'conflict' | 'environment' | 'saved' {
    if (this.#environmentIntegration != null) return 'environment'
    const value = integration(origin, callbackKey)
    return this.#store.putIntegration(expectedRevision, value.publicOrigin, value.callbackKey) ? 'saved' : 'conflict'
  }

  deleteIntegration(expectedRevision: number): 'conflict' | 'environment' | 'saved' {
    if (this.#environmentIntegration != null) return 'environment'
    return this.#store.deleteIntegration(expectedRevision) ? 'saved' : 'conflict'
  }

  putLlm(expectedRevision: number, origin: string, token: string | null, activate = true): 'conflict' | 'environment' | 'saved' {
    if (this.#environmentLlm != null) return 'environment'
    const secret = token ?? this.#store.state().llmToken ?? ''
    createLlm(origin, secret)
    return this.#store.putLlm(expectedRevision, new URL(origin).origin, secret, activate) ? 'saved' : 'conflict'
  }

  selectLlm(expectedRevision: number, mode: ServiceMode): 'conflict' | 'environment' | 'saved' {
    if (this.#environmentLlm != null) return 'environment'
    return this.#store.selectLlm(expectedRevision, mode) ? 'saved' : 'conflict'
  }

  deleteLlm(expectedRevision: number): 'conflict' | 'environment' | 'saved' {
    if (this.#environmentLlm != null) return 'environment'
    return this.#store.deleteLlm(expectedRevision) ? 'saved' : 'conflict'
  }

  #connectorValues(stored: ReturnType<SettingsStore['state']>): { readonly origin?: string; readonly token?: string } {
    return this.#connectorOrigin != null
      ? { origin: this.#connectorOrigin, token: this.#connectorToken ?? '' }
      : { origin: stored.connectorOrigin ?? undefined, token: stored.connectorToken ?? undefined }
  }
}

function publicOrigin(value: string): string {
  const origin = new URL(value)
  if (
    (origin.protocol != 'https:' && !(origin.protocol == 'http:' && ['127.0.0.1', '::1', '[::1]', 'localhost'].includes(origin.hostname))) ||
    origin.username != '' ||
    origin.password != '' ||
    origin.pathname != '/' ||
    origin.search != '' ||
    origin.hash != ''
  ) {
    throw new Error('Connector Console origin must be an HTTPS origin without credentials, a path, query, or fragment, except on loopback.')
  }
  return origin.origin
}

function integration(publicOriginValue: string, callbackKey: string): { readonly callbackKey: string; readonly publicOrigin: string } {
  if (Buffer.byteLength(callbackKey) < 32) throw new Error('Integration callback key must contain at least 32 UTF-8 bytes.')
  return { callbackKey, publicOrigin: publicOrigin(publicOriginValue) }
}

function hostedOrigin(origin: string | undefined): boolean {
  return origin != null && ['connector.oomol.com', 'connector.oomol.dev'].includes(new URL(origin).hostname)
}
