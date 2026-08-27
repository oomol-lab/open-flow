import './styles.css'
import type { FormEvent, ReactElement } from 'react'
import type { WorkbenchHost, WorkbenchLanguage, WorkbenchLocation, WorkbenchNavigationOptions, WorkbenchPreferences, WorkbenchTheme } from './contract.ts'

import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { I18nProvider } from 'val-i18n-react'
import { Button } from '../../../ui/browser/button.tsx'
import { Field, FieldError, FieldGroup, FieldLabel } from '../../../ui/browser/field.tsx'
import { Input } from '../../../ui/browser/input.tsx'
import { Spinner } from '../../../ui/browser/spinner.tsx'
import { WorkbenchClient } from './api.ts'
import { createI18n } from './i18n.ts'
import { NavigationStore } from './navigation.ts'
import { FlowBrowser } from './shell/resourceBrowser.tsx'
import { WorkbenchStore } from './stores/workbenchStore.ts'

const FlowWorkspace = lazy(() => import('./flowWorkspace.tsx'))

export function OpenFlowSessionGate({
  action,
  description,
  error,
  onSubmit,
  onTokenChange,
  pending = false,
  title,
  token,
  tokenLabel,
}: {
  readonly action?: string | undefined
  readonly description: string
  readonly error?: string | undefined
  readonly onSubmit?: ((event: FormEvent<HTMLFormElement>) => void) | undefined
  readonly onTokenChange?: ((value: string) => void) | undefined
  readonly pending?: boolean
  readonly title: string
  readonly token?: string | undefined
  readonly tokenLabel?: string | undefined
}): ReactElement {
  const hasToken = token != null && tokenLabel != null && onTokenChange != null
  const tokenValue = token ?? ''
  const fields = (
    <>
      <div aria-hidden="true" className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <svg className="size-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24">
          <rect height="9" rx="2" width="14" x="5" y="11" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
      </div>
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold tracking-tight text-balance">{title}</h1>
        <p className="text-sm/relaxed text-muted-foreground text-pretty">{description}</p>
      </header>
      {hasToken && (
        <FieldGroup>
          <Field data-invalid={error != null}>
            <FieldLabel htmlFor="session-token">{tokenLabel}</FieldLabel>
            <Input autoComplete="username" name="username" type="hidden" value="open-flow" readOnly />
            <Input
              autoComplete="current-password"
              aria-invalid={error != null}
              autoFocus
              className="h-9"
              id="session-token"
              name="session-token"
              onChange={(event) => onTokenChange?.(event.target.value)}
              spellCheck={false}
              type="password"
              value={tokenValue}
            />
            {error != null && <FieldError>{error}</FieldError>}
          </Field>
        </FieldGroup>
      )}
      {action != null && onSubmit != null && (
        <Button disabled={pending || (hasToken && tokenValue.length == 0)} size="lg" type="submit">
          {pending && <Spinner aria-label={action} data-icon="inline-start" />}
          {action}
        </Button>
      )}
      {pending && action == null && <Spinner aria-label={description} />}
    </>
  )
  const className = 'm-auto flex w-full max-w-[420px] flex-col gap-5 rounded-xl bg-card p-6 shadow-lg shadow-black/10'
  return (
    <main className="open-flow-workbench">
      <div className="grid h-full overflow-auto bg-muted/20 p-4">
        {onSubmit == null ? (
          <section aria-busy={pending} className={className}>
            {fields}
          </section>
        ) : (
          <form aria-busy={pending} className={className} onSubmit={onSubmit}>
            {fields}
          </form>
        )}
      </div>
    </main>
  )
}

function NotificationBridge({ host, store }: { readonly host: WorkbenchHost; readonly store: WorkbenchStore }): null {
  const notice = useVal(store.$.notice)
  useEffect(() => host.notify(notice), [host, notice])
  useEffect(() => () => host.notify(undefined), [host])
  return null
}

interface WorkbenchProps {
  readonly hrefFor: (location: WorkbenchLocation) => string
  readonly hostAction?: string | undefined
  readonly hostTitle?: string | undefined
  readonly language: WorkbenchLanguage
  readonly navigation: NavigationStore
  readonly onHostAction?: (() => void) | undefined
  readonly onLanguageChange?: ((language: WorkbenchLanguage) => void) | undefined
  readonly store: WorkbenchStore
  readonly theme: WorkbenchTheme
}

function Workbench({ hrefFor, hostAction, hostTitle, language, navigation, onHostAction, onLanguageChange, store, theme }: WorkbenchProps): ReactElement {
  const flowId = useVal(store.workspace.$.flowId)
  return (
    <div className="app-shell">
      {flowId == null ? (
        <FlowBrowser
          hrefForFlow={(flow) => hrefFor({ flowId: flow.flowId, view: 'design' })}
          hostAction={hostAction}
          hostTitle={hostTitle}
          language={language}
          onCreateFlow={(name) => navigation.createFlow(name)}
          onHostAction={onHostAction}
          onLanguageChange={onLanguageChange}
          onSelectFlow={(flow) => void navigation.selectFlow(flow)}
          store={store}
        />
      ) : (
        <Suspense fallback={<main aria-busy="true" className="workspace" />}>
          <FlowWorkspace
            hostAction={hostAction}
            hostTitle={hostTitle}
            hrefFor={hrefFor}
            navigation={navigation}
            onHostAction={onHostAction}
            store={store}
            theme={theme}
          />
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

export {
  isUiLanguage as isWorkbenchLanguage,
  resolveUiLanguage as resolveWorkbenchLanguage,
  uiLanguageNames as workbenchLanguageNames,
  uiLanguages as workbenchLanguages,
} from '../../../localization/common/languages.ts'

export interface OpenFlowWorkbenchProps {
  readonly host: WorkbenchHost
  readonly hrefFor: (location: WorkbenchLocation) => string
  readonly hostAction?: string | undefined
  readonly hostTitle?: string | undefined
  readonly language: WorkbenchLanguage
  readonly location: WorkbenchLocation
  readonly onLanguageChange?: ((language: WorkbenchLanguage) => void) | undefined
  readonly onHostAction?: (() => void) | undefined
  readonly onNavigate: (location: WorkbenchLocation, options: WorkbenchNavigationOptions) => void
  readonly preferences: WorkbenchPreferences
  readonly sessionKey: string
  readonly theme: WorkbenchTheme
}

type SessionProps = Omit<OpenFlowWorkbenchProps, 'sessionKey'>

function Session({
  host,
  hostAction,
  hostTitle,
  hrefFor,
  language,
  location,
  onHostAction,
  onLanguageChange,
  onNavigate,
  preferences,
  theme,
}: SessionProps): ReactElement {
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
      void store.refreshVariableNames()
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
        <Workbench
          hostAction={hostAction}
          hostTitle={hostTitle}
          hrefFor={hrefFor}
          language={language}
          navigation={navigation}
          onHostAction={onHostAction}
          onLanguageChange={onLanguageChange}
          store={store}
          theme={theme}
        />
      </div>
    </I18nProvider>
  )
}

export function OpenFlowWorkbench({ sessionKey, ...props }: OpenFlowWorkbenchProps): ReactElement {
  return <Session key={sessionKey} {...props} />
}
