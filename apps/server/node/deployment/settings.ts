import type { Logger } from 'pino'
import type { ServiceMode, ServiceProfile } from '../storage/settings-store.ts'
import type { LlmHost } from './llm.ts'

import { validateServiceProfile } from '../../common/service-profile.ts'
import { silentLogger } from '../logger.ts'
import { SettingsStore } from '../storage/settings-store.ts'
import { ConnectorClient } from './connector.ts'
import { createLlm, oomolLlm } from './llm.ts'

export class Settings {
  readonly #connectorConsoleOrigin?: string
  readonly #connectorOrigin?: string
  readonly #connectorToken?: string
  readonly #environmentConnector?: ConnectorClient
  readonly #environmentIntegration?: { readonly callbackKey: string; readonly publicOrigin: string }
  readonly #environmentLlm?: LlmHost
  readonly #environmentOrigin?: string
  readonly #logger: Logger
  readonly #store: SettingsStore
  #connectorCache?: { readonly client: ConnectorClient; readonly origin: string; readonly revision: number; readonly token: string }

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
      this.#environmentOrigin = new URL(environment.llmOrigin).origin
    }
  }

  connector(): ConnectorClient | undefined {
    if (this.#environmentConnector != null) return this.#environmentConnector
    const stored = this.#store.state()
    if (stored.connectorOrigin == null || stored.connectorToken == null) return undefined
    const cache = this.#connectorCache
    if (cache?.origin === stored.connectorOrigin && cache?.token === stored.connectorToken && cache?.revision === stored.revision) {
      return cache.client
    }
    const client = new ConnectorClient(stored.connectorOrigin, stored.connectorToken, 30_000, this.#logger)
    this.#connectorCache = { client, origin: stored.connectorOrigin, revision: stored.revision, token: stored.connectorToken }
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
    const stored = this.#store.state()
    const connector = this.#connectorValues(stored)
    if (this.#hosted(stored)) return oomolLlm(connector.origin, connector.token)
    if (this.#environmentLlm != null) return this.#environmentLlm
    if (stored.llmOrigin != null && stored.llmToken != null && stored.llmToken.trim() != '') return createLlm(stored.llmOrigin, stored.llmToken)
    return undefined
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
        llmOrigin: profile.llmOrigin ?? '',
        llmTokenConfigured: !!profile.llmToken,
      }
    }
    const managed = this.#environmentConnector != null || this.#environmentLlm != null || this.#connectorConsoleOrigin != null
    const services = {
      profiles: { oomol: profileStatus('oomol'), custom: profileStatus('custom') },
      mode: managed ? (this.#hosted(stored) ? ('oomol' as const) : ('custom' as const)) : stored.serviceMode,
      managed,
    }
    const base = { services, connector: { console, runtime: connector }, integration: integrationStatus, revision: stored.revision, version: 1 as const }
    if (this.#hosted()) {
      const active = this.#connectorValues(stored)
      const origin = derivedOrigin(active.origin, active.token)
      return origin == null
        ? { ...base, llm: { configured: false as const, source: 'none' as const, tokenConfigured: false as const } }
        : { ...base, llm: { configured: true as const, origin, source: 'derived' as const, tokenConfigured: true as const } }
    }
    if (this.#environmentOrigin != null) {
      return { ...base, llm: { configured: true as const, origin: this.#environmentOrigin, source: 'environment' as const, tokenConfigured: true as const } }
    }
    if (stored.llmOrigin != null && stored.llmToken != null && stored.llmToken.trim() != '') {
      return { ...base, llm: { configured: true as const, origin: stored.llmOrigin, source: 'settings' as const, tokenConfigured: true as const } }
    }
    return { ...base, llm: { configured: false as const, source: 'none' as const, tokenConfigured: false as const } }
  }

  saveProfile(
    expectedRevision: number,
    mode: ServiceMode,
    value: {
      readonly connectorOrigin: string
      readonly connectorToken: string | null
      readonly consoleOrigin: string
      readonly llmOrigin: string
      readonly llmToken: string | null
    },
  ): 'conflict' | 'environment' | 'saved' {
    if (this.#environmentConnector != null || this.#environmentLlm != null || this.#connectorConsoleOrigin != null) return 'environment'
    const previous = this.#store.profile(mode)
    const connectorToken = value.connectorToken ?? previous.connectorToken ?? ''
    const llmToken = value.llmToken ?? previous.llmToken ?? ''
    if (Object.values(validateServiceProfile(mode, { ...value, connectorToken, llmToken })).some((issue) => issue != 'required'))
      throw new Error('Invalid service configuration.')
    if (value.connectorOrigin.trim() != '') void new ConnectorClient(value.connectorOrigin, connectorToken, 30_000, this.#logger)
    if (mode == 'custom' && value.llmOrigin != '' && llmToken.trim() != '') createLlm(value.llmOrigin, llmToken)
    const profile: ServiceProfile = {
      connectorOrigin: value.connectorOrigin.trim() == '' ? null : new URL(value.connectorOrigin).href,
      connectorToken,
      consoleOrigin: mode == 'custom' && value.consoleOrigin != '' ? publicOrigin(value.consoleOrigin) : null,
      llmOrigin: mode == 'custom' && value.llmOrigin != '' ? new URL(value.llmOrigin).origin : null,
      llmToken: mode == 'custom' && value.llmOrigin != '' ? llmToken : null,
    }
    return this.#store.putProfile(expectedRevision, mode, profile) ? 'saved' : 'conflict'
  }

  selectProfile(expectedRevision: number, mode: ServiceMode): 'conflict' | 'environment' | 'saved' {
    if (this.#environmentConnector != null || this.#environmentLlm != null || this.#connectorConsoleOrigin != null) return 'environment'
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
    if (this.#environmentConnector != null || this.#environmentLlm != null || this.#connectorConsoleOrigin != null) return 'environment'
    return this.#store.putProfile(expectedRevision, this.#store.state().serviceMode ?? 'custom', {
      connectorOrigin: null,
      connectorToken: null,
      consoleOrigin: null,
      llmOrigin: null,
      llmToken: null,
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
    if (hostedOrigin(origin)) {
      if (this.#environmentLlm != null || this.#connectorConsoleOrigin != null) return 'environment'
      return this.#store.putServices(expectedRevision, {
        connectorOrigin: new URL(origin).href,
        connectorToken: token,
        consoleOrigin: null,
        llmOrigin: null,
        llmToken: null,
      })
        ? 'saved'
        : 'conflict'
    }
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

  putLlm(expectedRevision: number, origin: string, token: string): 'conflict' | 'environment' | 'saved' {
    if (this.#environmentLlm != null) return 'environment'
    if (this.#hosted()) throw new Error('OOMOL manages the hosted LLM.')
    createLlm(origin, token)
    return this.#store.putLlm(expectedRevision, new URL(origin).origin, token) ? 'saved' : 'conflict'
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

function derivedOrigin(connectorOrigin: string | undefined, token: string | undefined): string | undefined {
  if (connectorOrigin == null || token == null || token.length == 0) return
  const connector = new URL(connectorOrigin)
  if (connector.hostname != 'connector.oomol.com' && connector.hostname != 'connector.oomol.dev') return
  return `https://llm.${connector.hostname.slice('connector.'.length)}`
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
