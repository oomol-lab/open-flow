import type { FlowCatalogEvent, FlowChangeEvent } from '../../../control/common/flowNotifications.ts'
import type { UiLanguage } from '../../../localization/common/languages.ts'

export type { FlowCatalogEvent, FlowChangeEvent } from '../../../control/common/flowNotifications.ts'

export type WorkbenchLanguage = UiLanguage
export type WorkbenchTheme = 'dark' | 'light'
export type WorkbenchView = 'design' | 'publications' | 'runs'

export interface WorkbenchNotification {
  readonly kind: 'error' | 'success'
  readonly message: string
  readonly undo?: {
    readonly label: string
    /** Restores this notification's operation only while it is the current undo entry. */
    readonly run: () => Promise<void>
  }
}

/** Display data for an actor in the host's identity namespace. */
export interface WorkbenchActor {
  readonly name: string
  readonly avatarUrl?: string
}

export interface WorkbenchHost {
  /** Optional deployment-owned identity lookup. Return null for an unknown actor. */
  readonly resolveActor?: (actorId: string, signal: AbortSignal) => Promise<WorkbenchActor | null>

  /** Cache deployment identity. The session id must be stable and non-secret. */
  readonly cacheEnvironment?: string
  /** Host-selected connector owner identity, typically the Team from the host route. */
  readonly connectorOwnerId?: string
  notify(notification: WorkbenchNotification | undefined): void
  openExternalPage(resolveUrl: () => Promise<string>): Promise<boolean>
  request(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
  subscribeFlow(flowId: string, listener: (event?: FlowChangeEvent) => void): { readonly ready: Promise<void>; stop(): void }
  subscribeFlowCatalog(listener: (event?: FlowCatalogEvent) => void): { readonly ready: Promise<void>; stop(): void }
}

export interface WorkbenchLocation {
  /** Runs-only source filter. Hosts treat unknown URL values as absent. */
  readonly runSource?: 'draft' | 'live'
  readonly runId?: string
  readonly flowId?: string
  readonly view: WorkbenchView
}

export interface WorkbenchNavigationOptions {
  readonly replace: boolean
}

export interface WorkbenchPreferences {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** The host resolves deployment and Flow scope before rendering navigation links. */
export type ConnectionHref = (flowId: string, providerId: string, connectionId?: string) => string | undefined

/** Object values are complete response/ETag records; implementations must reject failures. */
