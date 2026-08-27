import type { FlowCatalogEvent, FlowChangeEvent } from '../../../control/common/flowNotifications.ts'
import type { UiLanguage } from '../../../localization/common/languages.ts'

export type { FlowCatalogEvent, FlowChangeEvent } from '../../../control/common/flowNotifications.ts'

export type WorkbenchLanguage = UiLanguage
export type WorkbenchTheme = 'dark' | 'light'
export type WorkbenchView = 'design' | 'publications' | 'runs'

export interface WorkbenchNotification {
  readonly kind: 'error' | 'success'
  readonly message: string
}

export interface WorkbenchHost {
  notify(notification: WorkbenchNotification | undefined): void
  openExternalPage(resolveUrl: () => Promise<string>): Promise<boolean>
  request(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
  subscribeFlow(flowId: string, listener: (event?: FlowChangeEvent) => void): () => void
  subscribeFlowCatalog(listener: (event?: FlowCatalogEvent) => void): () => void
}

export interface WorkbenchLocation {
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
