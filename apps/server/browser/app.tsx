import type {
  OpenFlowWorkbenchProps,
  WorkbenchLanguage,
  WorkbenchLocation,
  WorkbenchNavigationOptions,
  WorkbenchNotification,
  WorkbenchTheme,
} from '@oomol-lab/open-flow/workbench'
import type { FormEvent, MouseEvent, ReactElement } from 'react'

import { ControlClient } from '@oomol-lab/open-flow/control-api'
import { OpenFlowSessionGate, OpenFlowWorkbench } from '@oomol-lab/open-flow/workbench'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Toaster, toast } from 'sonner'
import { I18nProvider, useTranslate } from 'val-i18n-react'
import { createBrowserHost } from './host.ts'
import { createI18n } from './i18n.ts'
import { initialLanguage, languagePreference } from './language.ts'
import { parseRoute, routePath } from './route.ts'
import { SettingsPage } from './settings.tsx'
import { VariablesPage } from './variables.tsx'

const notificationId = 'open-flow-workbench'
const preferencePrefix = 'open-flow.workbench.server.'
interface Props {
  readonly language: WorkbenchLanguage
  readonly onLanguageChange: (language: WorkbenchLanguage) => void
  readonly theme: WorkbenchTheme
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
  | { readonly kind: 'signed-in' }

interface SessionStatus {
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
  return {
    authenticated: status.authenticated,
    configured: status.configured,
    setupAuthorized: status.setupAuthorized,
    setupRequired: status.setupRequired,
    source: status.source as 'environment' | 'none' | 'settings',
    version: 1,
  }
}

function connectorTeams(value: unknown):
  | { readonly bindings: readonly []; readonly enabled: false; readonly teams: readonly []; readonly version: 1 }
  | {
      readonly bindings: readonly { readonly flowId: string; readonly teamId: string }[]
      readonly enabled: true
      readonly teams: readonly { readonly id: string; readonly name: string; readonly systemCreated: boolean }[]
      readonly version: 1
    }
  | undefined {
  if (value == null || typeof value != 'object' || Array.isArray(value)) return
  const status = value as Record<string, unknown>
  if (status.version !== 1 || typeof status.enabled != 'boolean' || !Array.isArray(status.bindings) || !Array.isArray(status.teams)) return
  if (!status.enabled) return { bindings: [], enabled: false, teams: [], version: 1 }
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
  return { bindings, enabled: true, teams, version: 1 }
}

function notify(notification: WorkbenchNotification | undefined): void {
  if (notification == null) {
    toast.dismiss(notificationId)
    return
  }
  const options = { duration: notification.kind == 'error' ? 8000 : 4000, id: notificationId }
  if (notification.kind == 'error') toast.error(notification.message, options)
  else toast.success(notification.message, options)
}

function Shell({ language, onLanguageChange, theme }: Props): ReactElement {
  const [route, setRoute] = useState(() => parseRoute(window.location.pathname))
  const [settingsOpen, setSettingsOpen] = useState(window.location.pathname == '/settings')
  const [variablesOpen, setVariablesOpen] = useState(window.location.pathname == '/variables')
  const [session, setSession] = useState<Session>({ kind: 'checking' })
  const [token, setToken] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [team, setTeam] = useState<
    | { readonly kind: 'error' | 'hidden' | 'loading' }
    | {
        readonly bindings: readonly { readonly flowId: string; readonly teamId: string }[]
        readonly kind: 'ready'
        readonly selectedTeamId: string | undefined
        readonly teams: readonly { readonly id: string; readonly name: string; readonly systemCreated: boolean }[]
      }
  >({ kind: 'loading' })
  const t = useTranslate()
  const host = useMemo(() => createBrowserHost(notify, () => setSession({ configured: true, kind: 'signed-out' })), [])
  const client = useMemo(() => new ControlClient((input, init) => host.request(input, init)), [host])
  const preferences = useMemo(
    () => ({
      getItem: (key: string): string | null => localStorage.getItem(`${preferencePrefix}${key}`),
      setItem: (key: string, value: string): void => localStorage.setItem(`${preferencePrefix}${key}`, value),
    }),
    [],
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
      setTeam((current) => {
        if (!status.enabled) return { kind: 'hidden' }
        const selectedTeamId =
          current.kind == 'ready' && status.teams.some((item) => item.id == current.selectedTeamId)
            ? current.selectedTeamId
            : (status.teams.find((item) => item.systemCreated)?.id ?? status.teams[0]?.id)
        return { bindings: status.bindings, kind: 'ready', selectedTeamId, teams: status.teams }
      })
    } catch {
      if (!signal?.aborted) setTeam({ kind: 'error' })
    }
  }, [])
  const sessionExpired = useCallback(() => setSession({ configured: true, kind: 'signed-out' }), [])
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
          ? { kind: 'signed-in' }
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
      setSettingsOpen(window.location.pathname == '/settings')
      setVariablesOpen(window.location.pathname == '/variables')
      setRoute(parseRoute(window.location.pathname))
    }
    window.addEventListener('popstate', restore)
    return () => window.removeEventListener('popstate', restore)
  }, [])
  function navigate(next: WorkbenchLocation, options: WorkbenchNavigationOptions): void {
    const path = routePath(next)
    if (path != window.location.pathname) window.history[options.replace ? 'replaceState' : 'pushState'](null, '', path)
    setRoute(next)
    setSettingsOpen(false)
    setVariablesOpen(false)
  }

  function openPage(path: '/' | '/settings' | '/variables'): void {
    if (path != window.location.pathname) window.history.pushState(null, '', path)
    setSettingsOpen(path == '/settings')
    setVariablesOpen(path == '/variables')
    if (path == '/') setRoute({ view: 'design' })
  }

  function followPage(event: MouseEvent<HTMLAnchorElement>, path: '/' | '/settings' | '/variables'): void {
    if (event.defaultPrevented || event.button != 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    openPage(path)
  }

  async function signIn(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (token.length == 0 || submitting) return
    setSubmitting(true)
    try {
      const response = await fetch('/auth/session', {
        body: JSON.stringify({ token, version: 1 }),
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
      if (!response.ok) {
        setSession({ configured: true, error: response.status == 401 ? 'invalid' : 'unavailable', kind: 'signed-out' })
        return
      }
      setToken('')
      setSession({ kind: 'signed-in' })
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
      setSession(authorized ? { kind: 'signed-in' } : { configured: false, kind: 'signed-out', setupAuthorized: true, setupRequired: true })
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
      headers: { 'content-type': 'application/json', 'idempotency-key': `flow-${crypto.randomUUID()}` },
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
    return flowId
  }

  const teamOptions: { readonly label: string; readonly value: string }[] = []
  const defaultTeam = team.kind == 'ready' ? team.teams.find((item) => item.systemCreated) : undefined
  if (team.kind == 'ready') {
    if (defaultTeam != null) teamOptions.push({ label: t('team.defaultNamed', { name: defaultTeam.name }), value: defaultTeam.id })
    teamOptions.push(...team.teams.filter((item) => !item.systemCreated).map((item) => ({ label: item.name, value: item.id })))
  }
  let flowBadges: Readonly<Record<string, string>> | undefined
  if (team.kind == 'ready') {
    const teams = new Map(team.teams.map((item) => [item.id, item]))
    flowBadges = Object.fromEntries(
      team.bindings.map((binding) => {
        const bound = teams.get(binding.teamId)
        const name = bound?.systemCreated ? t('team.defaultNamed', { name: bound.name }) : (bound?.name ?? binding.teamId)
        return [binding.flowId, t('team.flowBadge', { name })]
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
  } else if (team.kind == 'error') {
    createFlowField = {
      description: t('team.fixedHint'),
      label: t('team.label'),
      onRetry: () => void loadTeams(),
      retry: t('team.retry'),
      state: 'error',
      status: t('team.loadFailed'),
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
      {session.kind == 'signed-in' ? (
        <>
          <header className="server-nav">
            <div className="server-nav-title">Open Flow Server</div>
            <nav aria-label="Open Flow Server">
              <a aria-current={variablesOpen || settingsOpen ? undefined : 'page'} href="/" onClick={(event) => followPage(event, '/')}>
                {t('shell.flows')}
              </a>
              <a aria-current={variablesOpen ? 'page' : undefined} href="/variables" onClick={(event) => followPage(event, '/variables')}>
                {t('shell.variables')}
              </a>
              <a aria-current={settingsOpen ? 'page' : undefined} href="/settings" onClick={(event) => followPage(event, '/settings')}>
                {t('shell.settings')}
              </a>
            </nav>
            <div className="server-nav-actions">
              <button className="server-button server-button-ghost server-sign-out" onClick={() => void signOut()} type="button">
                {t('session.signOut')}
              </button>
            </div>
          </header>
          <div className="workbench-frame">
            {settingsOpen ? (
              <SettingsPage onConnectorChange={() => void loadTeams()} onUnauthorized={sessionExpired} />
            ) : variablesOpen ? (
              <VariablesPage client={client} language={language} />
            ) : (
              <OpenFlowWorkbench
                createFlow={team.kind == 'ready' && team.selectedTeamId != null ? createHostedFlow : undefined}
                createFlowDisabled={team.kind != 'hidden' && (team.kind != 'ready' || team.selectedTeamId == null)}
                createFlowField={createFlowField}
                flowBadges={flowBadges}
                hrefFor={routePath}
                host={host}
                language={language}
                location={route}
                onConfigureConnector={() => openPage('/settings')}
                onLanguageChange={onLanguageChange}
                onNavigate={navigate}
                preferences={preferences}
                sessionKey="server-operator"
                theme={theme}
              />
            )}
          </div>
        </>
      ) : (
        <OpenFlowSessionGate
          action={
            session.kind == 'checking'
              ? undefined
              : session.setupRequired === true
                ? t(session.setupAuthorized === true ? 'session.setupFinish' : 'session.setupContinue')
                : session.configured === false || session.configured == null
                  ? t('session.retry')
                  : t('session.signIn')
          }
          description={session.kind == 'checking' ? t('session.checking') : sessionMessage}
          error={
            session.kind != 'signed-out' || session.error == null || session.error == 'unavailable'
              ? undefined
              : t(session.error == 'invalid' ? 'session.invalid' : session.error == 'setup-code' ? 'session.setupInvalidCode' : 'session.setupInvalidToken')
          }
          onSubmit={
            session.kind == 'checking'
              ? undefined
              : session.setupRequired === true
                ? (event) => void setup(event)
                : session.configured === false || session.configured == null
                  ? (event) => {
                      event.preventDefault()
                      void checkSession()
                    }
                  : (event) => void signIn(event)
          }
          onTokenChange={session.kind == 'signed-out' && (session.configured === true || session.setupRequired === true) ? setToken : undefined}
          pending={session.kind == 'checking' || submitting}
          title="Open Flow Server"
          token={session.kind == 'signed-out' && (session.configured === true || session.setupRequired === true) ? token : undefined}
          tokenLabel={
            session.kind == 'signed-out' && session.setupRequired === true
              ? t(session.setupAuthorized === true ? 'session.token' : 'session.setupCode')
              : session.kind == 'signed-out' && session.configured === true
                ? t('session.token')
                : undefined
          }
        />
      )}
      <Toaster
        closeButton
        containerAriaLabel={t('shell.notifications')}
        offset={{ right: 12, top: 50 }}
        position="top-right"
        richColors
        theme={theme}
        toastOptions={{ closeButtonAriaLabel: t('shell.closeNotification') }}
      />
    </div>
  )
}

export function App(): ReactElement {
  const [language, setLanguage] = useState(initialLanguage)
  const [theme, setTheme] = useState(initialTheme)
  const [i18n] = useState(() => createI18n(language))

  useEffect(() => {
    document.documentElement.lang = language
    localStorage.setItem(languagePreference, language)
    if (i18n.lang != language) void i18n.switchLang(language)
  }, [i18n, language])
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = (): void => setTheme(media.matches ? 'dark' : 'light')
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return (
    <I18nProvider i18n={i18n}>
      <Shell language={language} onLanguageChange={setLanguage} theme={theme} />
    </I18nProvider>
  )
}
