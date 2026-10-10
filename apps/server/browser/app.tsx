import type { OpenFlowWorkbenchProps, WorkbenchLanguage, WorkbenchLocation, WorkbenchNavigationOptions, WorkbenchTheme } from '@oomol-lab/open-flow/workbench'
import type { FormEvent, MouseEvent, ReactElement } from 'react'
import type { SessionUser } from '../common/users.ts'
import type { ConnectionConsole } from './connectionNavigation.ts'
import type { LoginCredentials } from './login.tsx'

import { ControlClient } from '@oomol-lab/open-flow/control-api'
import { Button, HostNavigationActions, OpenFlowLogo, notificationToasterProps } from '@oomol-lab/open-flow/ui'
import { EventSourcesPage, OpenFlowSessionGate, OpenFlowWorkbench } from '@oomol-lab/open-flow/workbench'
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { Toaster } from 'sonner'
import { I18nProvider, useTranslate } from 'val-i18n-react'
import { AgentAccessPage } from './agent-access.tsx'
import { connectionHref } from './connectionNavigation.ts'
import { HostPage, HostPageLayout, HostPageTabs } from './host-ui.tsx'
import { createBrowserHost } from './host.ts'
import { createI18n } from './i18n.ts'
import { idempotencyKey } from './idempotency.ts'
import { initialLanguage, languagePreference } from './language.ts'
import { Login } from './login.tsx'
import { notify } from './notifications.ts'
import { posthog } from './posthog.ts'
import { parseRouteContext, routeOwnerForFlow, routePath } from './route.ts'
import { SettingsPage, MemberSettingsPage, useConfiguration, serviceConfigurationMissing } from './settings.tsx'
import { UsersPage } from './users.tsx'
import { VariablesPage } from './variables.tsx'

type ThemeMode = WorkbenchTheme | 'auto'
const themePreference = 'open-flow.workbench.server.theme'

const preferencePrefix = 'open-flow.workbench.server.'
interface Props {
  readonly language: WorkbenchLanguage
  readonly onLanguageChange: (language: WorkbenchLanguage) => void
  readonly theme: WorkbenchTheme
  readonly themeMode: ThemeMode
  readonly onThemeModeChange: (mode: ThemeMode) => void
}

type Session =
  | { readonly kind: 'checking' }
  | {
      readonly configured?: boolean
      readonly error?: 'invalid' | 'setup-code' | 'setup-token' | 'unavailable'
      readonly kind: 'signed-out'
      readonly setupAuthorized?: boolean
      readonly setupRequired?: boolean
    }
  | { readonly kind: 'signed-in'; readonly user: SessionUser }

interface SessionStatus {
  readonly user: SessionUser | null
  readonly authenticated: boolean
  readonly configured: boolean
  readonly setupAuthorized: boolean
  readonly setupRequired: boolean
  readonly source: 'environment' | 'none' | 'settings'
  readonly version: 1
}

function initialTheme(): WorkbenchTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function sessionStatus(value: unknown): SessionStatus | undefined {
  if (value == null || typeof value != 'object' || Array.isArray(value)) return
  const status = value as Record<string, unknown>
  if (
    status.version !== 1 ||
    typeof status.authenticated != 'boolean' ||
    typeof status.configured != 'boolean' ||
    typeof status.setupAuthorized != 'boolean' ||
    typeof status.setupRequired != 'boolean' ||
    !['environment', 'none', 'settings'].includes(String(status.source))
  ) {
    return
  }
  let user: SessionUser | null = null
  if (status.authenticated) {
    if (status.user == null || typeof status.user != 'object' || Array.isArray(status.user)) return
    const profile = status.user as Record<string, unknown>
    if (
      typeof profile.userId != 'string' ||
      profile.userId.length == 0 ||
      (profile.email !== null && typeof profile.email != 'string') ||
      (profile.role != 'admin' && profile.role != 'user')
    )
      return
    user = { userId: profile.userId, email: profile.email as string | null, role: profile.role as SessionUser['role'] }
  }
  return {
    user,
    authenticated: status.authenticated,
    configured: status.configured,
    setupAuthorized: status.setupAuthorized,
    setupRequired: status.setupRequired,
    source: status.source as 'environment' | 'none' | 'settings',
    version: 1,
  }
}

function connectorTeams(value: unknown):
  | ({ readonly console: ConnectionConsole | undefined } & (
      | { readonly bindings: readonly []; readonly enabled: false; readonly teams: readonly []; readonly version: 1 }
      | {
          readonly bindings: readonly { readonly flowId: string; readonly teamId: string }[]
          readonly enabled: true
          readonly teams: readonly { readonly id: string; readonly name: string; readonly systemCreated: boolean }[]
          readonly version: 1
        }
    ))
  | undefined {
  if (value == null || typeof value != 'object' || Array.isArray(value)) return
  const status = value as Record<string, unknown>
  if (status.version !== 1 || typeof status.enabled != 'boolean' || !Array.isArray(status.bindings) || !Array.isArray(status.teams)) return
  let console: ConnectionConsole | undefined
  if (status.console != null) {
    if (typeof status.console != 'object' || Array.isArray(status.console)) return
    const configuration = status.console as Record<string, unknown>
    if (typeof configuration.origin != 'string' || typeof configuration.teamScoped != 'boolean') return
    try {
      const origin = new URL(configuration.origin)
      if (origin.protocol != 'https:' && origin.protocol != 'http:') return
      console = { origin: origin.href, teamScoped: configuration.teamScoped }
    } catch {
      return
    }
  }
  if (!status.enabled) return { bindings: [], enabled: false, teams: [], version: 1, console }
  const bindings: { readonly flowId: string; readonly teamId: string }[] = []
  for (const item of status.bindings) {
    if (item == null || typeof item != 'object' || Array.isArray(item)) return
    const binding = item as Record<string, unknown>
    if (typeof binding.flowId != 'string' || binding.flowId.length == 0 || typeof binding.teamId != 'string' || binding.teamId.length == 0) return
    bindings.push({ flowId: binding.flowId, teamId: binding.teamId })
  }
  const teams: { readonly id: string; readonly name: string; readonly systemCreated: boolean }[] = []
  for (const item of status.teams) {
    if (item == null || typeof item != 'object' || Array.isArray(item)) return
    const team = item as Record<string, unknown>
    if (typeof team.id != 'string' || team.id.length == 0 || typeof team.name != 'string' || team.name.length == 0 || typeof team.systemCreated != 'boolean') {
      return
    }
    teams.push({ id: team.id, name: team.name, systemCreated: team.systemCreated })
  }
  return { bindings, enabled: true, teams, version: 1, console }
}

function Shell({ language, onLanguageChange, theme, themeMode, onThemeModeChange }: Props): ReactElement {
  const [routeUrl, setRouteUrl] = useState(() => window.location.pathname + window.location.search)
  const pathname = routeUrl.split('?')[0]
  const routeContext = useMemo(() => parseRouteContext(routeUrl), [routeUrl])
  const route = routeContext.location
  const eventSourcesOpen = pathname == '/settings/event-sources'
  const usersOpen = pathname == '/settings/users'
  const agentAccessOpen = pathname == '/agents'
  const settingsOpen = pathname == '/settings' || eventSourcesOpen || usersOpen
  const variablesOpen = pathname == '/variables'
  const [session, setSession] = useState<Session>({ kind: 'checking' })
  const administrator = session.kind == 'signed-in' && session.user.role == 'admin'
  const userId = session.kind == 'signed-in' ? session.user.userId : undefined
  const [connectionConsole, setConnectionConsole] = useState<ConnectionConsole>()
  const [token, setToken] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [team, setTeam] = useState<
    | { readonly kind: 'empty' | 'error' | 'hidden' | 'loading' }
    | {
        readonly bindings: readonly { readonly flowId: string; readonly teamId: string }[]
        readonly kind: 'ready'
        readonly selectedTeamId: string | undefined
        readonly teams: readonly { readonly id: string; readonly name: string; readonly systemCreated: boolean }[]
      }
  >({ kind: 'loading' })
  const t = useTranslate()
  const host = useMemo(
    () => createBrowserHost(notify, () => setSession({ configured: true, kind: 'signed-out' }), routeContext.connectorOwnerId),
    [routeContext.connectorOwnerId],
  )
  const client = useMemo(() => new ControlClient((input, init) => host.request(input, init)), [host])
  const preferences = useMemo(
    () => ({
      getItem: (key: string): string | null => localStorage.getItem(`${preferencePrefix}${userId}.${key}`),
      setItem: (key: string, value: string): void => localStorage.setItem(`${preferencePrefix}${userId}.${key}`, value),
    }),
    [userId],
  )
  const loadTeams = useCallback(async (signal?: AbortSignal): Promise<void> => {
    try {
      const response = await fetch('/connector/teams', { credentials: 'same-origin', signal })
      if (response.status == 401) {
        setSession({ configured: true, kind: 'signed-out' })
        return
      }
      const status = connectorTeams(await response.json())
      if (!response.ok || status == null) throw new Error('Invalid Connector Team response.')
      setConnectionConsole(status.console)
      setTeam((current) => {
        if (!status.enabled) return { kind: 'hidden' }
        const selectedTeamId =
          current.kind == 'ready' && status.teams.some((item) => item.id == current.selectedTeamId)
            ? current.selectedTeamId
            : (status.teams.find((item) => item.systemCreated)?.id ?? status.teams[0]?.id)
        return {
          bindings: status.bindings,
          kind: status.teams.length == 0 ? 'empty' : 'ready',
          selectedTeamId,
          teams: status.teams,
        }
      })
    } catch {
      if (!signal?.aborted) setTeam({ kind: 'error' })
    }
  }, [])
  const sessionExpired = useCallback(() => setSession({ configured: true, kind: 'signed-out' }), [])
  const configuration = useConfiguration(sessionExpired, administrator)
  let sessionMessage = t('session.configured')
  if (session.kind == 'signed-out') {
    if (session.setupRequired === true) {
      sessionMessage = t(session.setupAuthorized === true ? 'session.setupTokenDescription' : 'session.setupCodeDescription')
    } else if (session.configured === false) sessionMessage = t('session.notConfigured')
    else if (session.error == 'unavailable') sessionMessage = t('session.unavailable')
  }

  async function checkSession(): Promise<void> {
    setSession({ kind: 'checking' })
    try {
      const response = await fetch('/auth/session', { credentials: 'same-origin' })
      const status = sessionStatus(await response.json())
      if (!response.ok || status == null) throw new Error('Invalid session response.')
      setSession(
        status.authenticated
          ? { kind: 'signed-in', user: status.user! }
          : {
              configured: status.configured,
              kind: 'signed-out',
              setupAuthorized: status.setupAuthorized,
              setupRequired: status.setupRequired,
            },
      )
    } catch {
      setSession({ error: 'unavailable', kind: 'signed-out' })
    }
  }

  useEffect(() => void checkSession(), [])
  useEffect(() => {
    if (session.kind != 'signed-in') {
      setTeam({ kind: 'loading' })
      return
    }
    const controller = new AbortController()
    void loadTeams(controller.signal)
    return () => controller.abort()
  }, [loadTeams, session.kind])
  useEffect(() => {
    const restore = (): void => {
      setRouteUrl(window.location.pathname + window.location.search)
    }
    window.addEventListener('popstate', restore)
    return () => window.removeEventListener('popstate', restore)
  }, [])
  const connectorOwnerForFlow = (flowId: string | undefined): string | undefined =>
    routeOwnerForFlow(route, routeContext.connectorOwnerId, flowId, team.kind == 'ready' ? team.bindings : [], team.kind == 'ready' ? team.teams : [])
  function navigate(next: WorkbenchLocation, options: WorkbenchNavigationOptions): void {
    const path = routePath(next, connectorOwnerForFlow(next.flowId))
    if (path != window.location.pathname + window.location.search) window.history[options.replace ? 'replaceState' : 'pushState'](null, '', path)
    setRouteUrl(path)
  }

  function openPage(path: '/' | '/agents' | '/settings' | '/settings/users' | '/settings/event-sources' | '/variables'): void {
    if (path != window.location.pathname + window.location.search) window.history.pushState(null, '', path)
    setRouteUrl(path)
  }

  function followPage(
    event: MouseEvent<HTMLAnchorElement>,
    path: '/' | '/agents' | '/settings' | '/settings/users' | '/settings/event-sources' | '/variables',
  ): void {
    if (event.defaultPrevented || event.button != 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    openPage(path)
  }

  async function signIn(credentials: LoginCredentials): Promise<void> {
    if (submitting) return
    setSubmitting(true)
    try {
      const response = await fetch('token' in credentials ? '/auth/session' : '/auth/user-session', {
        body: JSON.stringify({ ...credentials, version: 1 }),
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
      if (!response.ok) {
        setSession({ configured: true, error: response.status == 401 ? 'invalid' : 'unavailable', kind: 'signed-out' })
        return
      }
      await checkSession()
    } catch {
      setSession({ configured: true, error: 'unavailable', kind: 'signed-out' })
    } finally {
      setSubmitting(false)
    }
  }

  async function setup(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (token.length == 0 || submitting || session.kind != 'signed-out' || session.setupRequired !== true) return
    setSubmitting(true)
    const authorized = session.setupAuthorized === true
    try {
      const response = await fetch(authorized ? '/auth/setup' : '/auth/setup/session', {
        body: JSON.stringify({ [authorized ? 'token' : 'code']: token, version: 1 }),
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
      if (response.status == 409) {
        setToken('')
        await checkSession()
        return
      }
      if (!response.ok) {
        setSession({
          configured: false,
          error: authorized ? 'setup-token' : 'setup-code',
          kind: 'signed-out',
          setupAuthorized: authorized,
          setupRequired: true,
        })
        return
      }
      setToken('')
      setSession(
        authorized
          ? { kind: 'signed-in', user: { userId: 'operator', email: null, role: 'admin' } }
          : { configured: false, kind: 'signed-out', setupAuthorized: true, setupRequired: true },
      )
    } catch {
      setSession({ configured: false, error: 'unavailable', kind: 'signed-out', setupAuthorized: authorized, setupRequired: true })
    } finally {
      setSubmitting(false)
    }
  }

  async function signOut(): Promise<void> {
    try {
      const response = await fetch('/auth/session', { credentials: 'same-origin', method: 'DELETE' })
      if (!response.ok) throw new Error('Session logout failed.')
      notify(undefined)
      posthog?.reset()
      window.history.replaceState(null, '', '/')
      setRouteUrl('/')
      setSession({ configured: true, kind: 'signed-out' })
    } catch {
      notify({ kind: 'error', message: t('session.unavailable') })
    }
  }

  async function createHostedFlow(name: string): Promise<string> {
    if (team.kind != 'ready' || team.selectedTeamId == null) throw new Error(t('team.loadFailed'))
    const teamId = team.selectedTeamId
    const response = await fetch('/connector/flows', {
      body: JSON.stringify({ name, teamId, version: 1 }),
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'idempotency-key': `flow-${idempotencyKey()}` },
      method: 'POST',
    })
    const value = (await response.json()) as unknown
    if (response.status == 401) setSession({ configured: true, kind: 'signed-out' })
    if (!response.ok) {
      const source = value != null && typeof value == 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
      const error =
        source?.error != null && typeof source.error == 'object' && !Array.isArray(source.error) ? (source.error as Record<string, unknown>) : undefined
      throw new Error(typeof error?.message == 'string' ? error.message : t('team.createFailed'))
    }
    const source = value != null && typeof value == 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
    if (typeof source?.flowId != 'string' || source.flowId.length == 0) throw new Error(t('team.createFailed'))
    const flowId = source.flowId
    setTeam((current) =>
      current.kind == 'ready' ? { ...current, bindings: [...current.bindings.filter((binding) => binding.flowId != flowId), { flowId, teamId }] } : current,
    )
    posthog?.capture('flow_created')
    return flowId
  }

  const teamOptions: { readonly label: string; readonly value: string }[] = []
  const defaultTeam = team.kind == 'ready' ? team.teams.find((item) => item.systemCreated) : undefined
  if (team.kind == 'ready') {
    if (defaultTeam != null) teamOptions.push({ label: t('team.defaultNamed', { name: defaultTeam.name }), value: defaultTeam.id })
    teamOptions.push(...team.teams.filter((item) => item.id != defaultTeam?.id).map((item) => ({ label: item.name, value: item.id })))
  }
  let flowBadges: Readonly<Record<string, string>> | undefined
  if (team.kind == 'ready') {
    const teams = new Map(team.teams.map((item) => [item.id, item]))
    flowBadges = Object.fromEntries(
      team.bindings.map((binding) => {
        const bound = teams.get(binding.teamId)
        return [binding.flowId, bound?.name ?? binding.teamId]
      }),
    )
  }
  let createFlowField: OpenFlowWorkbenchProps['createFlowField']
  if (team.kind == 'ready' && team.selectedTeamId != null) {
    createFlowField = {
      ariaLabel: t('team.selectForCreation'),
      description: t('team.fixedHint'),
      label: t('team.label'),
      onValueChange: (selectedTeamId) => setTeam({ ...team, selectedTeamId }),
      options: teamOptions,
      state: 'ready',
      value: team.selectedTeamId,
    }
  } else if (team.kind == 'empty' || team.kind == 'error') {
    createFlowField = {
      description: t('team.fixedHint'),
      label: t('team.label'),
      onRetry: () => void loadTeams(),
      retry: t('team.retry'),
      state: 'error',
      status: t(team.kind == 'empty' ? 'team.noTeams' : 'team.loadFailed'),
    }
  } else if (team.kind == 'loading') {
    createFlowField = {
      description: t('team.fixedHint'),
      label: t('team.label'),
      state: 'loading',
      status: t('team.loading'),
    }
  }

  return (
    <div className="open-flow-theme server-host" data-theme={theme}>
      {session.kind == 'checking' ? (
        <main aria-live="polite" className="server-session-checking" role="status">
          {t('session.checking')}
        </main>
      ) : session.kind == 'signed-in' ? (
        <>
          <header className="server-nav">
            <div className="server-nav-title">
              <OpenFlowLogo theme={theme} alt="" />
              Open Flow
            </div>
            <nav aria-label="Open Flow">
              <a aria-current={variablesOpen || settingsOpen || agentAccessOpen ? undefined : 'page'} href="/" onClick={(event) => followPage(event, '/')}>
                {t('shell.flows')}
              </a>
              <a aria-current={variablesOpen ? 'page' : undefined} href="/variables" onClick={(event) => followPage(event, '/variables')}>
                {t('shell.variables')}
              </a>
              <a aria-current={agentAccessOpen ? 'page' : undefined} href="/agents" onClick={(event) => followPage(event, '/agents')}>
                {t('agentAccess.title')}
              </a>
              <a
                data-danger={(administrator && serviceConfigurationMissing(configuration.current)) || undefined}
                aria-current={settingsOpen ? 'page' : undefined}
                href="/settings"
                onClick={(event) => followPage(event, '/settings')}
              >
                {t(administrator ? 'shell.settings' : 'shell.memberSettings')}
              </a>
            </nav>
            <div className="server-nav-actions">
              <HostNavigationActions
                language={language}
                onLanguageChange={onLanguageChange}
                theme={themeMode}
                onThemeChange={onThemeModeChange}
                labels={{
                  theme: t('shell.theme', { mode: t(`shell.${themeMode}`) }),
                  language: t('shell.language'),
                  light: t('shell.light'),
                  dark: t('shell.dark'),
                  auto: t('shell.auto'),
                }}
              />
            </div>
          </header>
          <div className="workbench-frame">
            {(usersOpen || eventSourcesOpen) && !administrator ? (
              <HostPage>
                <p>{t('users.adminRequired')}</p>
                <Button onClick={() => openPage('/')}>{t('shell.flows')}</Button>
              </HostPage>
            ) : agentAccessOpen ? (
              <AgentAccessPage key={session.user.userId} onUnauthorized={sessionExpired} />
            ) : settingsOpen && !administrator ? (
              <MemberSettingsPage user={session.user} onSignOut={() => void signOut()} />
            ) : settingsOpen ? (
              <HostPageLayout
                navigation={
                  <HostPageTabs
                    kind="routes"
                    label={t('shell.settings')}
                    active={usersOpen ? '/settings/users' : eventSourcesOpen ? '/settings/event-sources' : '/settings'}
                    onNavigate={followPage}
                    items={[
                      { value: '/settings', label: t('settings.title') },
                      { value: '/settings/users', label: t('users.title') },
                      { value: '/settings/event-sources', label: t('settings.eventSources') },
                    ]}
                  />
                }
              >
                {usersOpen ? (
                  <UsersPage currentUserId={session.user.userId} onUnauthorized={sessionExpired} />
                ) : eventSourcesOpen ? (
                  <EventSourcesPage client={client} language={language} teams={team.kind == 'ready' ? team.teams : []} />
                ) : (
                  <SettingsPage
                    user={session.user}
                    configuration={configuration}
                    onSignOut={() => void signOut()}
                    onConnectorChange={() => void loadTeams()}
                    onUnauthorized={sessionExpired}
                  />
                )}
              </HostPageLayout>
            ) : variablesOpen ? (
              <VariablesPage client={client} language={language} />
            ) : (
              <OpenFlowWorkbench
                createFlow={team.kind == 'ready' && team.selectedTeamId != null ? createHostedFlow : undefined}
                createFlowDisabled={team.kind != 'hidden' && (team.kind != 'ready' || team.selectedTeamId == null)}
                createFlowField={createFlowField}
                flowBadges={flowBadges}
                connectionHref={
                  administrator
                    ? (flowId, providerId, connectionId) => connectionHref(connectionConsole, connectorOwnerForFlow(flowId), providerId, connectionId)
                    : undefined
                }
                hrefFor={(location) => routePath(location, connectorOwnerForFlow(location.flowId))}
                host={host}
                language={language}
                location={route}
                onConfigureConnector={administrator ? () => openPage('/settings') : undefined}
                onLanguageChange={onLanguageChange}
                onNavigate={navigate}
                preferences={preferences}
                sessionKey={session.user.userId}
                theme={theme}
                variables
              />
            )}
          </div>
        </>
      ) : session.configured === true && session.setupRequired !== true ? (
        <Login error={session.error == 'invalid' || session.error == 'unavailable' ? session.error : undefined} pending={submitting} onSubmit={signIn} />
      ) : (
        <OpenFlowSessionGate
          action={
            session.setupRequired === true
              ? t(session.setupAuthorized === true ? 'session.setupFinish' : 'session.setupContinue')
              : session.configured === false || session.configured == null
                ? t('session.retry')
                : t('session.signIn')
          }
          description={sessionMessage}
          error={
            session.error == null || session.error == 'unavailable'
              ? undefined
              : t(session.error == 'invalid' ? 'session.invalid' : session.error == 'setup-code' ? 'session.setupInvalidCode' : 'session.setupInvalidToken')
          }
          onSubmit={
            session.setupRequired === true
              ? (event) => void setup(event)
              : session.configured === false || session.configured == null
                ? (event) => {
                    event.preventDefault()
                    void checkSession()
                  }
                : (event) => {
                    event.preventDefault()
                    void checkSession()
                  }
          }
          onTokenChange={session.configured === true || session.setupRequired === true ? setToken : undefined}
          pending={submitting}
          title="Open Flow Server"
          token={session.configured === true || session.setupRequired === true ? token : undefined}
          tokenLabel={
            session.setupRequired === true
              ? t(session.setupAuthorized === true ? 'session.token' : 'session.setupCode')
              : session.configured === true
                ? t('session.token')
                : undefined
          }
        />
      )}
      <Toaster
        {...notificationToasterProps}
        containerAriaLabel={t('shell.notifications')}
        theme={theme}
        toastOptions={{ closeButtonAriaLabel: t('shell.closeNotification') }}
      />
    </div>
  )
}

export function App(): ReactElement {
  const [language, setLanguage] = useState(initialLanguage)
  const [systemTheme, setSystemTheme] = useState(initialTheme)
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const stored = localStorage.getItem(themePreference)
    return stored == 'light' || stored == 'dark' ? stored : 'auto'
  })
  const theme = themeMode == 'auto' ? systemTheme : themeMode
  useEffect(() => localStorage.setItem(themePreference, themeMode), [themeMode])
  const [i18n] = useState(() => createI18n(language))

  useLayoutEffect(() => {
    document.body.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    document.documentElement.lang = language
    localStorage.setItem(languagePreference, language)
    if (i18n.lang != language) void i18n.switchLang(language)
  }, [i18n, language])
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = (): void => setSystemTheme(media.matches ? 'dark' : 'light')
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return (
    <I18nProvider i18n={i18n}>
      <Shell language={language} onLanguageChange={setLanguage} theme={theme} themeMode={themeMode} onThemeModeChange={setThemeMode} />
    </I18nProvider>
  )
}
