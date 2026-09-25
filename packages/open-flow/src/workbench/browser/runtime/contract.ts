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

export interface WorkbenchHost {
  /** Shared, optional persistent catalog responses, isolated by browser origin. */
  readonly catalogCache?: {
    readonly storage?: CatalogCacheStorage
  }
  readonly connectionCache?: {
    readonly storage?: WorkbenchPreferences
  }
  notify(notification: WorkbenchNotification | undefined): void
  openExternalPage(resolveUrl: () => Promise<string>): Promise<boolean>
  request(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
  subscribeFlow(flowId: string, listener: (event?: FlowChangeEvent) => void): { readonly ready: Promise<void>; stop(): void }
  subscribeFlowCatalog(listener: (event?: FlowCatalogEvent) => void): { readonly ready: Promise<void>; stop(): void }
}

export interface WorkbenchLocation {
  /** Runs-only source filter. Hosts treat unknown URL values as absent. */
  readonly runSource?: 'draft' | 'live'
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
export interface CatalogCacheStorage {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
}
