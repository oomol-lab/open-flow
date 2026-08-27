import type { WorkbenchLanguage, WorkbenchLocation, WorkbenchNavigationOptions, WorkbenchNotification, WorkbenchTheme } from '@oomol-lab/open-flow/workbench'
import type { FormEvent, ReactElement } from 'react'

import { ControlClient } from '@oomol-lab/open-flow/control-api'
import { OpenFlowSessionGate, OpenFlowWorkbench } from '@oomol-lab/open-flow/workbench'
import { useEffect, useMemo, useState } from 'react'
import { Toaster, toast } from 'sonner'
import { I18nProvider, useTranslate } from 'val-i18n-react'
import { createBrowserHost } from './host.ts'
import { createI18n } from './i18n.ts'
import { initialLanguage, languagePreference } from './language.ts'
import { parseRoute, routePath } from './route.ts'
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
  | { readonly configured?: boolean; readonly error?: 'invalid' | 'unavailable'; readonly kind: 'signed-out' }
  | { readonly kind: 'signed-in' }

interface SessionStatus {
  readonly authenticated: boolean
  readonly configured: boolean
  readonly version: 1
}

function initialTheme(): WorkbenchTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function sessionStatus(value: unknown): SessionStatus | undefined {
  if (value == null || typeof value != 'object' || Array.isArray(value)) return
  const status = value as Record<string, unknown>
  if (status.version !== 1 || typeof status.authenticated != 'boolean' || typeof status.configured != 'boolean') return
  return { authenticated: status.authenticated, configured: status.configured, version: 1 }
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
  const [variablesOpen, setVariablesOpen] = useState(window.location.pathname == '/variables')
  const [session, setSession] = useState<Session>({ kind: 'checking' })
  const [token, setToken] = useState('')
  const [submitting, setSubmitting] = useState(false)
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
  let sessionMessage = t('session.configured')
  if (session.kind == 'signed-out') {
    if (session.configured === false) sessionMessage = t('session.notConfigured')
    else if (session.error == 'unavailable') sessionMessage = t('session.unavailable')
  }

  async function checkSession(): Promise<void> {
    setSession({ kind: 'checking' })
    try {
      const response = await fetch('/auth/session', { credentials: 'same-origin' })
      const status = sessionStatus(await response.json())
      if (!response.ok || status == null) throw new Error('Invalid session response.')
      setSession(status.authenticated ? { kind: 'signed-in' } : { configured: status.configured, kind: 'signed-out' })
    } catch {
      setSession({ error: 'unavailable', kind: 'signed-out' })
    }
  }

  useEffect(() => void checkSession(), [])
  useEffect(() => {
    const restore = (): void => {
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
    setVariablesOpen(false)
  }

  function openPage(path: '/' | '/variables'): void {
    if (path != window.location.pathname) window.history.pushState(null, '', path)
    setVariablesOpen(path == '/variables')
    if (path == '/') setRoute({ view: 'design' })
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

  return (
    <div className="open-flow-theme server-host" data-theme={theme}>
      {session.kind == 'signed-in' ? (
        <>
          <header className="server-nav">
            <div className="server-nav-title">Open Flow Server</div>
            <nav aria-label="Open Flow Server">
              <button aria-current={variablesOpen ? undefined : 'page'} onClick={() => openPage('/')} type="button">
                {t('shell.flows')}
              </button>
              <button aria-current={variablesOpen ? 'page' : undefined} onClick={() => openPage('/variables')} type="button">
                {t('shell.variables')}
              </button>
            </nav>
            <button className="server-sign-out" onClick={() => void signOut()} type="button">
              {t('session.signOut')}
            </button>
          </header>
          <div className="workbench-frame">
            {variablesOpen ? (
              <VariablesPage client={client} language={language} />
            ) : (
              <OpenFlowWorkbench
                hrefFor={routePath}
                host={host}
                language={language}
                location={route}
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
            session.kind == 'checking' ? undefined : session.configured === false || session.configured == null ? t('session.retry') : t('session.signIn')
          }
          description={session.kind == 'checking' ? t('session.checking') : sessionMessage}
          error={session.kind == 'signed-out' && session.error == 'invalid' ? t('session.invalid') : undefined}
          onSubmit={
            session.kind == 'checking'
              ? undefined
              : session.configured === false || session.configured == null
                ? (event) => {
                    event.preventDefault()
                    void checkSession()
                  }
                : (event) => void signIn(event)
          }
          onTokenChange={session.kind == 'signed-out' && session.configured === true ? setToken : undefined}
          pending={session.kind == 'checking' || submitting}
          title="Open Flow Server"
          token={session.kind == 'signed-out' && session.configured === true ? token : undefined}
          tokenLabel={session.kind == 'signed-out' && session.configured === true ? t('session.token') : undefined}
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
