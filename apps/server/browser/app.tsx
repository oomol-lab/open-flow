import type { WorkbenchLanguage, WorkbenchLocation, WorkbenchNavigationOptions, WorkbenchNotification, WorkbenchTheme } from '@oomol-lab/open-flow/workbench'
import type { FormEvent, ReactElement } from 'react'

import { OpenFlowSessionGate, OpenFlowWorkbench } from '@oomol-lab/open-flow/workbench'
import { useEffect, useMemo, useState } from 'react'
import { Toaster, toast } from 'sonner'
import { createBrowserHost } from './host.ts'
import { parseRoute, routePath } from './route.ts'

const languagePreference = 'open-flow.workbench.language'
const notificationId = 'open-flow-workbench'
const preferencePrefix = 'open-flow.workbench.server.'

const copy = {
  'en': {
    checking: 'Checking operator session…',
    closeNotification: 'Close notification',
    configured: 'Sign in with the operator token configured for this deployment.',
    invalid: 'The operator token is invalid.',
    notConfigured: 'Set OPEN_FLOW_TOKEN on the server before signing in.',
    notifications: 'Notifications',
    retry: 'Retry',
    signIn: 'Sign in',
    signOut: 'Sign out',
    token: 'Operator token',
    unavailable: 'The Server server could not be reached.',
  },
  'zh-CN': {
    checking: '正在检查 operator session…',
    closeNotification: '关闭通知',
    configured: '使用当前 deployment 配置的 operator token 登录。',
    invalid: 'Operator token 不正确。',
    notConfigured: '请先在服务端配置 OPEN_FLOW_TOKEN。',
    notifications: '通知',
    retry: '重试',
    signIn: '登录',
    signOut: '退出',
    token: 'Operator token',
    unavailable: '无法连接 Server 服务。',
  },
} as const

type Session =
  | { readonly kind: 'checking' }
  | { readonly configured?: boolean; readonly error?: 'invalid' | 'unavailable'; readonly kind: 'signed-out' }
  | { readonly kind: 'signed-in' }

interface SessionStatus {
  readonly authenticated: boolean
  readonly configured: boolean
  readonly version: 1
}

function initialLanguage(): WorkbenchLanguage {
  const preferred = localStorage.getItem(languagePreference)
  if (preferred == 'en' || preferred == 'zh-CN') return preferred
  return navigator.languages.some((language) => language.toLowerCase().startsWith('zh')) ? 'zh-CN' : 'en'
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

export function App(): ReactElement {
  const [language, setLanguage] = useState(initialLanguage)
  const [theme, setTheme] = useState(initialTheme)
  const [route, setRoute] = useState(() => parseRoute(window.location.pathname))
  const [session, setSession] = useState<Session>({ kind: 'checking' })
  const [token, setToken] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const t = copy[language]
  const host = useMemo(() => createBrowserHost(notify, () => setSession({ configured: true, kind: 'signed-out' })), [])
  const preferences = useMemo(
    () => ({
      getItem: (key: string): string | null => localStorage.getItem(`${preferencePrefix}${key}`),
      setItem: (key: string, value: string): void => localStorage.setItem(`${preferencePrefix}${key}`, value),
    }),
    [],
  )
  let sessionMessage: string = t.configured
  if (session.kind == 'signed-out') {
    if (session.configured === false) sessionMessage = t.notConfigured
    else if (session.error == 'unavailable') sessionMessage = t.unavailable
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
    document.documentElement.lang = language
    localStorage.setItem(languagePreference, language)
  }, [language])
  useEffect(() => {
    const restore = (): void => setRoute(parseRoute(window.location.pathname))
    window.addEventListener('popstate', restore)
    return () => window.removeEventListener('popstate', restore)
  }, [])
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = (): void => setTheme(media.matches ? 'dark' : 'light')
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
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
    try {
      const response = await fetch('/auth/session', { credentials: 'same-origin', method: 'DELETE' })
      if (!response.ok) throw new Error('Session logout failed.')
      notify(undefined)
      setSession({ configured: true, kind: 'signed-out' })
    } catch {
      notify({ kind: 'error', message: t.unavailable })
    }
  }

  return (
    <div className="open-flow-theme server-host" data-theme={theme}>
      {session.kind == 'signed-in' ? (
        <div className="workbench-frame">
          <OpenFlowWorkbench
            hrefFor={routePath}
            host={host}
            hostAction={t.signOut}
            hostTitle="Open Flow Server"
            language={language}
            location={route}
            onHostAction={() => void signOut()}
            onLanguageChange={setLanguage}
            onNavigate={navigate}
            preferences={preferences}
            sessionKey="server-operator"
            theme={theme}
          />
        </div>
      ) : (
        <OpenFlowSessionGate
          action={session.kind == 'checking' ? undefined : session.configured === false || session.configured == null ? t.retry : t.signIn}
          description={session.kind == 'checking' ? t.checking : sessionMessage}
          error={session.kind == 'signed-out' && session.error == 'invalid' ? t.invalid : undefined}
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
          tokenLabel={session.kind == 'signed-out' && session.configured === true ? t.token : undefined}
        />
      )}
      <Toaster
        closeButton
        containerAriaLabel={t.notifications}
        offset={{ right: 12, top: 50 }}
        position="top-right"
        richColors
        theme={theme}
        toastOptions={{ closeButtonAriaLabel: t.closeNotification }}
      />
    </div>
  )
}
