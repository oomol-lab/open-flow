import type { WorkbenchLanguage, WorkbenchLocation, WorkbenchNavigationOptions, WorkbenchNotification, WorkbenchTheme } from '@oomol-lab/open-flow/workbench'
import type { FormEvent, ReactElement } from 'react'

import { OpenFlowWorkbench } from '@oomol-lab/open-flow/workbench'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Toaster, toast } from 'sonner'
import { I18nProvider, useTranslate } from 'val-i18n-react'
import { createBrowserHost } from './host.ts'
import { createI18n } from './i18n.ts'
import { initialLanguage, languagePreference } from './language.ts'
import { parseRoute, routePath } from './route.ts'

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
  const [session, setSession] = useState<Session>({ kind: 'checking' })
  const [token, setToken] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [operatorMenuOpen, setOperatorMenuOpen] = useState(false)
  const operatorMenu = useRef<HTMLDivElement>(null)
  const t = useTranslate()
  const host = useMemo(() => createBrowserHost(notify, () => setSession({ configured: true, kind: 'signed-out' })), [])
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
    const restore = (): void => setRoute(parseRoute(window.location.pathname))
    window.addEventListener('popstate', restore)
    return () => window.removeEventListener('popstate', restore)
  }, [])
  useEffect(() => {
    if (!operatorMenuOpen) return
    const close = (event: PointerEvent): void => {
      if (event.target instanceof Node && !operatorMenu.current?.contains(event.target)) setOperatorMenuOpen(false)
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key != 'Escape') return
      setOperatorMenuOpen(false)
      operatorMenu.current?.querySelector<HTMLButtonElement>('.operator-menu-trigger')?.focus()
    }
    globalThis.addEventListener('pointerdown', close)
    globalThis.addEventListener('keydown', escape)
    return () => {
      globalThis.removeEventListener('pointerdown', close)
      globalThis.removeEventListener('keydown', escape)
    }
  }, [operatorMenuOpen])

  function navigate(next: WorkbenchLocation, options: WorkbenchNavigationOptions): void {
    const path = routePath(next)
    if (path != window.location.pathname) window.history[options.replace ? 'replaceState' : 'pushState'](null, '', path)
    setRoute(next)
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
    setOperatorMenuOpen(false)
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
          <div className="operator-menu" ref={operatorMenu}>
            <button
              aria-expanded={operatorMenuOpen}
              aria-haspopup="dialog"
              aria-label={t('shell.moreActions')}
              className="operator-menu-trigger"
              onClick={() => setOperatorMenuOpen(!operatorMenuOpen)}
              title={t('shell.moreActions')}
              type="button"
            >
              <svg aria-hidden="true" fill="currentColor" height="18" viewBox="0 0 24 24" width="18">
                <circle cx="5" cy="12" r="1.5" />
                <circle cx="12" cy="12" r="1.5" />
                <circle cx="19" cy="12" r="1.5" />
              </svg>
            </button>
            {operatorMenuOpen && (
              <div aria-label={t('shell.moreActions')} className="operator-menu-popup" role="dialog">
                <div className="operator-menu-label">Open Flow Server</div>
                <button className="operator-menu-sign-out" onClick={() => void signOut()} type="button">
                  {t('session.signOut')}
                </button>
              </div>
            )}
          </div>
          <div className="workbench-frame">
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
          </div>
        </>
      ) : (
        <main className="session-gate">
          {session.kind == 'checking' ? (
            <p>{t('session.checking')}</p>
          ) : (
            <form className="session-form" onSubmit={(event) => void signIn(event)}>
              <strong>Open Flow Server</strong>
              <p>{sessionMessage}</p>
              {session.configured === false || session.configured == null ? (
                <button onClick={() => void checkSession()} type="button">
                  {t('session.retry')}
                </button>
              ) : (
                <>
                  <input autoComplete="username" name="username" type="hidden" value="operator" />
                  <label htmlFor="operator-token">{t('session.token')}</label>
                  <input
                    autoComplete="current-password"
                    autoFocus
                    id="operator-token"
                    onChange={(event) => setToken(event.target.value)}
                    type="password"
                    value={token}
                  />
                  {session.error == 'invalid' ? <span className="session-error">{t('session.invalid')}</span> : null}
                  <button disabled={token.length == 0 || submitting} type="submit">
                    {t('session.signIn')}
                  </button>
                </>
              )}
            </form>
          )}
        </main>
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
