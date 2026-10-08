import type { FormEvent, ReactElement } from 'react'

import { Button, Input, Label } from '@oomol-lab/open-flow/ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useTranslate } from 'val-i18n-react'
import { posthog } from './posthog.ts'

const sources = ['derived', 'environment', 'none', 'settings'] as const

function setting(value: unknown, originKey: string, token: boolean) {
  if (value == null || typeof value != 'object' || Array.isArray(value)) return
  const body = value as Record<string, unknown>
  if (
    typeof body.configured != 'boolean' ||
    !sources.includes(body.source as (typeof sources)[number]) ||
    (body.configured && typeof body[originKey] != 'string') ||
    (token && typeof body.tokenConfigured != 'boolean')
  ) {
    return
  }
  return {
    configured: body.configured,
    origin: typeof body[originKey] == 'string' ? body[originKey] : '',
    source: body.source as (typeof sources)[number],
    tokenConfigured: token && body.tokenConfigured === true,
  }
}

function config(value: unknown) {
  if (value == null || typeof value != 'object' || Array.isArray(value)) return
  const body = value as Record<string, unknown>
  if (body.version !== 1 || !Number.isSafeInteger(body.revision) || body.connector == null || typeof body.connector != 'object') return
  const connector = body.connector as Record<string, unknown>
  const runtime = setting(connector.runtime, 'origin', true)
  const console = setting(connector.console, 'origin', false)
  const integration = setting(body.integration, 'publicOrigin', false)
  const llm = setting(body.llm, 'origin', true)
  if (runtime == null || console == null || integration == null || llm == null) return
  return { connector: { console, runtime }, integration, llm, revision: Number(body.revision) }
}

function randomCallbackKey(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function OomolConnectorLogin({
  connected,
  onConflict,
  onSaved,
  onUnauthorized,
  revision,
}: {
  readonly connected: boolean
  readonly onConflict: () => Promise<void>
  readonly onSaved: (value: NonNullable<ReturnType<typeof config>>) => void
  readonly onUnauthorized: () => void
  readonly revision: number
}): ReactElement {
  const [starting, setStarting] = useState(false)
  const [login, setLogin] = useState<{ readonly code: string; readonly url: string }>()
  const [error, setError] = useState<'expired' | 'failed'>()
  const active = useRef<{ readonly controller: AbortController; id?: string }>()
  const t = useTranslate()
  const endpoint = '/config/connector/oomol-login'

  const stop = useCallback((): void => {
    const operation = active.current
    active.current = undefined
    operation?.controller.abort()
    if (operation?.id != null) {
      void fetch(endpoint, {
        body: JSON.stringify({ id: operation.id, version: 1 }),
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        keepalive: true,
        method: 'DELETE',
      }).catch(() => {})
    }
  }, [])

  useEffect(() => stop, [stop])

  async function connect(): Promise<void> {
    if (active.current != null) return
    const popup = window.open('about:blank', '_blank')
    if (popup != null) popup.opener = null
    const operation = { controller: new AbortController(), id: undefined as string | undefined }
    active.current = operation
    setStarting(true)
    setError(undefined)
    try {
      const request = async (method: 'POST' | 'PUT', body: Record<string, unknown>) => {
        const response = await fetch(endpoint, {
          body: JSON.stringify({ ...body, version: 1 }),
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          method,
          signal: operation.controller.signal,
        })
        if (operation.controller.signal.aborted) throw new Error('Canceled.')
        if (response.status == 401) {
          operation.controller.abort()
          onUnauthorized()
          throw new Error('Unauthorized.')
        }
        if (response.status == 409) {
          operation.controller.abort()
          toast.error(t('settings.changed'))
          await onConflict()
          throw new Error('Configuration changed.')
        }
        if (response.status == 410) {
          setError('expired')
          throw new Error('Authorization expired.')
        }
        if (!response.ok) throw new Error('Authorization failed.')
        const value: unknown = await response.json()
        if (value == null || typeof value != 'object' || Array.isArray(value)) throw new Error('Invalid authorization response.')
        return value as Record<string, unknown>
      }

      const session = await request('POST', { expectedRevision: revision })
      if (operation.controller.signal.aborted) return
      if (session.version !== 1 || typeof session.id != 'string' || typeof session.code != 'string' || typeof session.url != 'string')
        throw new Error('Invalid authorization response.')
      operation.id = session.id
      setLogin({ code: session.code, url: session.url })
      setStarting(false)
      if (popup != null) popup.location.replace(session.url)
      while (!operation.controller.signal.aborted) {
        const result = await request('PUT', { id: session.id })
        if (operation.controller.signal.aborted) return
        if (result.version !== 1) throw new Error('Invalid authorization response.')
        if (result.status == 'saved') {
          const value = config(result.configuration)
          if (value == null) throw new Error('Invalid configuration response.')
          operation.id = undefined
          onSaved(value)
          posthog?.capture('configuration_saved', { configuration_type: 'connector_runtime' })
          toast.success(t('settings.oomolConnected'))
          return
        }
        if (result.status != 'waiting') throw new Error('Invalid authorization response.')
        await new Promise((resolve) => setTimeout(resolve, 2_000))
      }
    } catch {
      if (operation.id == null) popup?.close()
      if (!operation.controller.signal.aborted) {
        setError((current) => current ?? 'failed')
      }
    } finally {
      if (active.current === operation) {
        stop()
        setStarting(false)
        setLogin(undefined)
      }
    }
  }

  return (
    <div className="settings-oomol">
      <p>{t('settings.oomolDescription')}</p>
      <div className="settings-actions">
        <Button size="sm" disabled={starting || login != null} onClick={() => void connect()} type="button">
          {t(starting ? 'settings.oomolStarting' : connected ? 'settings.oomolReconnect' : 'settings.oomolConnect')}
        </Button>
        {(starting || login != null) && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              stop()
              setStarting(false)
              setLogin(undefined)
            }}
            type="button"
          >
            {t('settings.cancel')}
          </Button>
        )}
      </div>
      {login != null && (
        <div className="settings-oomol-status" role="status">
          <span>
            {t('settings.oomolWaiting')} <code>{login.code}</code>
          </span>
          <a href={login.url} rel="noopener noreferrer" target="_blank">
            {t('settings.oomolOpenAuthorization')}
          </a>
        </div>
      )}
      {error != null && <p role="alert">{t(error == 'expired' ? 'settings.oomolExpired' : 'settings.oomolFailed')}</p>}
    </div>
  )
}

function SettingItem({
  analyticsType,
  body,
  configured,
  description,
  endpoint,
  heading = 'h2',
  name,
  onConflict,
  onSaved,
  onUnauthorized,
  origin,
  originLabel,
  originHint,
  placeholder,
  revision,
  generateSecret = false,
  secretLabel,
  secretHint,
  secretRequired = true,
  summaryHint,
  source,
}: {
  readonly analyticsType: 'connector_console' | 'connector_runtime' | 'integration' | 'llm'
  readonly body: (origin: string, secret: string) => Record<string, unknown>
  readonly configured: boolean
  readonly description?: string
  readonly endpoint: string
  readonly heading?: 'h2' | 'h3'
  readonly name: string
  readonly onConflict: () => Promise<void>
  readonly onSaved: (value: NonNullable<ReturnType<typeof config>>) => void
  readonly onUnauthorized: () => void
  readonly origin: string
  readonly originLabel?: string
  readonly originHint?: string
  readonly placeholder?: string
  readonly revision: number
  readonly generateSecret?: boolean
  readonly secretLabel?: string
  readonly secretHint?: string
  readonly secretRequired?: boolean
  readonly summaryHint?: string
  readonly source: (typeof sources)[number]
}): ReactElement {
  const [draftOrigin, setDraftOrigin] = useState(origin)
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [secret, setSecret] = useState('')
  const t = useTranslate()
  const managed = source == 'environment' || source == 'derived'
  const secretTooShort = endpoint == '/config/integration' && new TextEncoder().encode(secret).byteLength < 32
  const Heading = heading

  async function request(method: 'DELETE' | 'PUT', requestBody: Record<string, unknown>): Promise<void> {
    setPending(true)
    try {
      const response = await fetch(endpoint, {
        body: JSON.stringify(requestBody),
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        method,
      })
      if (response.status == 401) {
        onUnauthorized()
        return
      }
      if (response.status == 409) {
        toast.error(t('settings.changed'))
        await onConflict()
        return
      }
      const value = config(await response.json())
      if (!response.ok || value == null) throw new Error('Invalid configuration response.')
      setEditing(false)
      setRemoving(false)
      setSecret('')
      onSaved(value)
      posthog?.capture(method == 'PUT' ? 'configuration_saved' : 'configuration_deleted', { configuration_type: analyticsType })
    } catch {
      toast.error(t(method == 'PUT' ? 'settings.saveFailed' : 'settings.deleteFailed'))
    } finally {
      setPending(false)
    }
  }

  function edit(): void {
    setDraftOrigin(origin)
    setEditing(true)
    setRemoving(false)
    setSecret('')
  }

  function save(event: FormEvent): void {
    event.preventDefault()
    if (draftOrigin.length == 0 || (secretLabel != null && secretRequired && secret.length == 0) || secretTooShort || pending) return
    void request('PUT', { ...body(draftOrigin, secret), expectedRevision: revision, version: 1 })
  }

  return (
    <div aria-busy={pending} className="settings-item">
      <div className="settings-heading">
        <div className="settings-heading-copy">
          <Heading>{name}</Heading>
          {description != null && <p>{description}</p>}
          <span>{t(`settings.source.${source}`)}</span>
        </div>
        {!managed && !editing && (
          <div className="settings-actions">
            {configured &&
              (removing ? (
                <>
                  <span>{t('settings.deleteConfirm')}</span>
                  <Button variant="outline" size="sm" disabled={pending} onClick={() => setRemoving(false)} type="button">
                    {t('settings.cancel')}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={pending}
                    onClick={() => void request('DELETE', { expectedRevision: revision, version: 1 })}
                    type="button"
                  >
                    {t('settings.delete')}
                  </Button>
                </>
              ) : (
                <Button variant="destructive" size="sm" onClick={() => setRemoving(true)} type="button">
                  {t('settings.delete')}
                </Button>
              ))}
            <Button variant="outline" size="sm" onClick={edit} type="button">
              {t(configured ? 'settings.edit' : 'settings.configure')}
            </Button>
          </div>
        )}
      </div>
      {editing ? (
        <form className="settings-form" onSubmit={save}>
          {originLabel != null && (
            <>
              <Label htmlFor={`${endpoint}-origin`}>{originLabel}</Label>
              <Input
                autoComplete="url"
                aria-describedby={originHint == null ? undefined : `${endpoint}-origin-hint`}
                autoFocus
                id={`${endpoint}-origin`}
                onChange={(event) => setDraftOrigin(event.target.value)}
                placeholder={placeholder}
                spellCheck={false}
                type="url"
                value={draftOrigin}
              />
            </>
          )}
          {originHint != null && (
            <span className="settings-hint" id={`${endpoint}-origin-hint`}>
              {originHint}
            </span>
          )}
          {secretLabel != null && (
            <>
              <div className="settings-secret-label">
                <Label htmlFor={`${endpoint}-secret`}>{secretLabel}</Label>
                {generateSecret && (
                  <Button variant="outline" size="sm" disabled={pending} onClick={() => setSecret(randomCallbackKey())} type="button">
                    {t('settings.generateSecret')}
                  </Button>
                )}
              </div>
              <Input
                aria-describedby={`${endpoint}-secret-hint`}
                aria-invalid={secretTooShort && secret != ''}
                autoFocus={originLabel == null}
                autoComplete="new-password"
                id={`${endpoint}-secret`}
                onChange={(event) => setSecret(event.target.value)}
                spellCheck={false}
                type="password"
                value={secret}
              />
              <span className="settings-hint" id={`${endpoint}-secret-hint`}>
                {secretHint ?? t(endpoint == '/config/integration' ? 'settings.callbackKeyHint' : 'settings.tokenHint')}
              </span>
            </>
          )}
          <div className="settings-form-actions">
            <Button variant="outline" size="default" disabled={pending} onClick={() => setEditing(false)} type="button">
              {t('settings.cancel')}
            </Button>
            <Button
              variant="default"
              size="default"
              disabled={pending || draftOrigin.length == 0 || (secretLabel != null && secretRequired && secret.length == 0) || secretTooShort}
              type="submit"
            >
              {t('settings.save')}
            </Button>
          </div>
        </form>
      ) : configured && (originLabel != null || summaryHint != null || managed) ? (
        <div className="settings-summary">
          {originLabel != null && <code>{origin}</code>}
          {summaryHint != null && source == 'settings' && <p>{summaryHint}</p>}
          {managed && <p>{t(source == 'environment' ? 'settings.environmentHint' : 'settings.derivedHint')}</p>}
        </div>
      ) : null}
    </div>
  )
}

function ConnectorSettings({
  current,
  onConflict,
  onConnectorChange,
  onSaved,
  onUnauthorized,
}: {
  readonly current: NonNullable<ReturnType<typeof config>>
  readonly onConflict: () => Promise<void>
  readonly onConnectorChange: () => void
  readonly onSaved: (value: NonNullable<ReturnType<typeof config>>) => void
  readonly onUnauthorized: () => void
}): ReactElement {
  const [selectedMode, setSelectedMode] = useState<'oomol' | 'custom'>()
  const t = useTranslate()
  const runtime = current.connector.runtime
  const hostname = runtime.configured ? new URL(runtime.origin).hostname : undefined
  const hosted = hostname == 'connector.oomol.com' || hostname == 'connector.oomol.dev'
  const configuredMode = runtime.configured && !hosted ? 'custom' : 'oomol'
  const mode = selectedMode ?? configuredMode
  const managed = runtime.source == 'environment'
  const saved = (value: NonNullable<ReturnType<typeof config>>): void => {
    onSaved(value)
    onConnectorChange()
  }

  return (
    <section className="settings-section settings-group">
      <div className="settings-group-heading">
        <h2>{t('settings.connector')}</h2>
        <p>{t('settings.connectorDescription')}</p>
      </div>
      <fieldset className="settings-connector-mode" disabled={managed}>
        <legend>{t('settings.connectorMode')}</legend>
        <label>
          <input checked={mode == 'oomol'} name="connector-mode" onChange={() => setSelectedMode('oomol')} type="radio" value="oomol" />
          {t('settings.oomolHosted')}
        </label>
        <label>
          <input checked={mode == 'custom'} name="connector-mode" onChange={() => setSelectedMode('custom')} type="radio" value="custom" />
          {t('settings.connectorCustom')}
        </label>
      </fieldset>
      {runtime.configured && mode != configuredMode && (
        <p className="settings-connector-hint">{t(mode == 'custom' ? 'settings.connectorSwitchCustom' : 'settings.connectorSwitchOomol')}</p>
      )}
      {mode == 'oomol' && !managed && (
        <OomolConnectorLogin
          connected={hosted && runtime.tokenConfigured}
          onConflict={onConflict}
          onSaved={saved}
          onUnauthorized={onUnauthorized}
          revision={current.revision}
        />
      )}
      <SettingItem
        key={mode}
        analyticsType="connector_runtime"
        body={(origin, token) => ({ origin, token })}
        configured={mode == configuredMode && runtime.configured && (mode == 'custom' || runtime.tokenConfigured)}
        description={t(
          mode == 'custom' ? 'settings.runtimeDescription' : hosted && runtime.tokenConfigured ? 'settings.oomolConfigured' : 'settings.apiKeyDescription',
        )}
        endpoint="/config/connector"
        heading="h3"
        name={mode == 'oomol' ? 'API key' : t('settings.runtime')}
        onConflict={onConflict}
        onSaved={saved}
        onUnauthorized={onUnauthorized}
        origin={
          mode == 'oomol' ? (hostname == 'connector.oomol.dev' ? 'https://connector.oomol.dev' : 'https://connector.oomol.com') : hosted ? '' : runtime.origin
        }
        originLabel={mode == 'custom' ? t('settings.origin') : undefined}
        placeholder={mode == 'custom' ? 'https://connector.example.com' : undefined}
        revision={current.revision}
        secretHint={mode == 'oomol' ? t('settings.apiKeyHint') : undefined}
        secretLabel={mode == 'oomol' ? 'API key' : t('settings.token')}
        secretRequired={mode == 'oomol'}
        source={mode == configuredMode ? runtime.source : 'none'}
      />
      {mode == 'custom' && (
        <SettingItem
          analyticsType="connector_console"
          body={(origin) => ({ origin })}
          {...current.connector.console}
          description={t('settings.consoleDescription')}
          endpoint="/config/connector-console"
          heading="h3"
          name={t('settings.console')}
          onConflict={onConflict}
          onSaved={onSaved}
          onUnauthorized={onUnauthorized}
          originLabel={t('settings.console')}
          placeholder="https://console.example.com"
          revision={current.revision}
        />
      )}
    </section>
  )
}

export function SettingsPage({
  onSignOut,
  onConnectorChange,
  onUnauthorized,
}: {
  readonly onSignOut: () => void
  readonly onConnectorChange: () => void
  readonly onUnauthorized: () => void
}): ReactElement {
  const [current, setCurrent] = useState<NonNullable<ReturnType<typeof config>>>()
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)
  const loadSequence = useRef(0)
  const t = useTranslate()

  const saved = useCallback((value: NonNullable<ReturnType<typeof config>>): void => {
    loadSequence.current += 1
    setCurrent((previous) => (previous != null && previous.revision > value.revision ? previous : value))
    setFailed(false)
    setLoading(false)
  }, [])

  const load = useCallback(async (): Promise<void> => {
    const sequence = ++loadSequence.current
    try {
      const response = await fetch('/config', { credentials: 'same-origin' })
      if (sequence != loadSequence.current) return
      if (response.status == 401) {
        onUnauthorized()
        return
      }
      const value = config(await response.json())
      if (sequence != loadSequence.current) return
      if (!response.ok || value == null) throw new Error('Invalid configuration response.')
      setCurrent((previous) => (previous != null && previous.revision > value.revision ? previous : value))
      setFailed(false)
    } catch {
      if (sequence != loadSequence.current) return
      setFailed(true)
      toast.error(t('settings.loadFailed'))
    } finally {
      if (sequence == loadSequence.current) setLoading(false)
    }
  }, [onUnauthorized, t])

  useEffect(() => {
    void load()
    const refresh = (): void => void load()
    globalThis.addEventListener('focus', refresh)
    return () => {
      loadSequence.current += 1
      globalThis.removeEventListener('focus', refresh)
    }
  }, [load])

  return (
    <main className="settings-page">
      <div className="settings-content">
        <header className="settings-header">
          <h1>{t('settings.title')}</h1>
          <p>{t('settings.description')}</p>
        </header>
        {loading || current == null ? (
          <section className="settings-section">
            <div className="settings-state" role={failed ? 'alert' : undefined}>
              <span>{t(failed ? 'settings.loadFailed' : 'settings.loading')}</span>
              {failed && (
                <Button
                  variant="outline"
                  size="default"
                  onClick={() => {
                    setLoading(true)
                    void load()
                  }}
                  type="button"
                >
                  {t('settings.retry')}
                </Button>
              )}
            </div>
          </section>
        ) : (
          <>
            <ConnectorSettings current={current} onConflict={load} onConnectorChange={onConnectorChange} onSaved={saved} onUnauthorized={onUnauthorized} />
            <section className="settings-section">
              <SettingItem
                analyticsType="llm"
                body={(origin, token) => ({ origin, token })}
                {...current.llm}
                endpoint="/config/llm"
                name="LLM"
                onConflict={load}
                onSaved={saved}
                onUnauthorized={onUnauthorized}
                originLabel={t('settings.origin')}
                placeholder="https://llm.example.com"
                revision={current.revision}
                secretLabel={t('settings.token')}
              />
            </section>
            <section className="settings-section">
              <SettingItem
                analyticsType="integration"
                body={(publicOrigin, callbackKey) => ({ callbackKey, publicOrigin })}
                {...current.integration}
                endpoint="/config/integration"
                description={t('settings.integrationDescription')}
                name={t('settings.integration')}
                onConflict={load}
                onSaved={saved}
                onUnauthorized={onUnauthorized}
                originLabel={t('settings.publicOrigin')}
                originHint={t('settings.publicOriginHint')}
                placeholder="https://flows.example.com"
                revision={current.revision}
                generateSecret
                secretLabel={t('settings.callbackKey')}
                secretHint={t('settings.callbackKeyHint')}
                summaryHint={t('settings.callbackKeyStored')}
              />
            </section>
          </>
        )}
        <section className="settings-section" aria-labelledby="settings-session-title">
          <div className="settings-heading">
            <h2 id="settings-session-title">{t('settings.session')}</h2>
            <Button variant="outline" size="sm" type="button" onClick={onSignOut}>
              {t('session.signOut')}
            </Button>
          </div>
        </section>
      </div>
    </main>
  )
}
