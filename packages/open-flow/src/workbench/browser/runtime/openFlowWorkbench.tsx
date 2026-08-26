import './styles.css'
import type { ReactElement } from 'react'
import type { WorkbenchHost, WorkbenchLanguage, WorkbenchLocation, WorkbenchNavigationOptions, WorkbenchPreferences, WorkbenchTheme } from './contract.ts'

import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { I18nProvider } from 'val-i18n-react'
import { WorkbenchClient } from './api.ts'
import { createI18n } from './i18n.ts'
import { NavigationStore } from './navigation.ts'
import { FlowBrowser } from './shell/resourceBrowser.tsx'
import { WorkbenchStore } from './stores/workbenchStore.ts'

const FlowWorkspace = lazy(() => import('./flowWorkspace.tsx'))

function NotificationBridge({ host, store }: { readonly host: WorkbenchHost; readonly store: WorkbenchStore }): null {
  const notice = useVal(store.$.notice)
  useEffect(() => host.notify(notice), [host, notice])
  useEffect(() => () => host.notify(undefined), [host])
  return null
}

interface WorkbenchProps {
  readonly hrefFor: (location: WorkbenchLocation) => string
  readonly language: WorkbenchLanguage
  readonly navigation: NavigationStore
  readonly onLanguageChange?: ((language: WorkbenchLanguage) => void) | undefined
  readonly store: WorkbenchStore
  readonly theme: WorkbenchTheme
}

function Workbench({ hrefFor, language, navigation, onLanguageChange, store, theme }: WorkbenchProps): ReactElement {
  const flowId = useVal(store.workspace.$.flowId)
  return (
    <div className="app-shell">
      {flowId == null ? (
        <FlowBrowser
          hrefForFlow={(flow) => hrefFor({ flowId: flow.flowId, view: 'design' })}
          language={language}
          onCreateFlow={(name) => navigation.createFlow(name)}
          onLanguageChange={onLanguageChange}
          onSelectFlow={(flow) => void navigation.selectFlow(flow)}
          store={store}
        />
      ) : (
        <Suspense fallback={<main aria-busy="true" className="workspace" />}>
          <FlowWorkspace hrefFor={hrefFor} navigation={navigation} store={store} theme={theme} />
        </Suspense>
      )}
    </div>
  )
}

export type {
  FlowCatalogEvent,
  FlowChangeEvent,
  WorkbenchHost,
  WorkbenchLanguage,
  WorkbenchLocation,
  WorkbenchNavigationOptions,
  WorkbenchNotification,
  WorkbenchPreferences,
  WorkbenchTheme,
  WorkbenchView,
} from './contract.ts'

export interface OpenFlowWorkbenchProps {
  readonly host: WorkbenchHost
  readonly hrefFor: (location: WorkbenchLocation) => string
  readonly language: WorkbenchLanguage
  readonly location: WorkbenchLocation
  readonly onLanguageChange?: ((language: WorkbenchLanguage) => void) | undefined
  readonly onNavigate: (location: WorkbenchLocation, options: WorkbenchNavigationOptions) => void
  readonly preferences: WorkbenchPreferences
  readonly sessionKey: string
  readonly theme: WorkbenchTheme
}

type SessionProps = Omit<OpenFlowWorkbenchProps, 'sessionKey'>

function Session({ host, hrefFor, language, location, onLanguageChange, onNavigate, preferences, theme }: SessionProps): ReactElement {
  const navigate = useRef(onNavigate)
  navigate.current = onNavigate
  const [{ i18n, navigation, store }] = useState(() => {
    const workbenchI18n = createI18n(language)
    const workbenchStore = new WorkbenchStore(
      new WorkbenchClient(
        (input, init) => host.request(input, init),
        (flowId, listener) => host.subscribeFlow(flowId, listener),
        (listener) => host.subscribeFlowCatalog(listener),
      ),
      preferences,
      () => crypto.randomUUID(),
      workbenchI18n,
      host,
    )
    return {
      i18n: workbenchI18n,
      navigation: new NavigationStore(workbenchStore, location, (nextLocation, options) => navigate.current(nextLocation, options)),
      store: workbenchStore,
    }
  })
  useEffect(() => {
    void navigation.start()
    const refreshConnections = (): void => {
      void store.connectors.refreshAfterAuthorization()
      void store.triggers.refreshAfterAuthorization()
    }
    globalThis.addEventListener('focus', refreshConnections)
    return () => {
      globalThis.removeEventListener('focus', refreshConnections)
      navigation.dispose()
      store.dispose()
      i18n.dispose()
    }
  }, [i18n, navigation, store])
  useEffect(() => void navigation.apply(location), [location, navigation])
  useEffect(() => {
    if (i18n.lang != language) void i18n.switchLang(language)
  }, [i18n, language])
  return (
    <I18nProvider i18n={i18n}>
      <div className="open-flow-theme open-flow-workbench" data-theme={theme}>
        <NotificationBridge host={host} store={store} />
        <Workbench hrefFor={hrefFor} language={language} navigation={navigation} onLanguageChange={onLanguageChange} store={store} theme={theme} />
      </div>
    </I18nProvider>
  )
}

export function OpenFlowWorkbench({ sessionKey, ...props }: OpenFlowWorkbenchProps): ReactElement {
  return <Session key={sessionKey} {...props} />
}
