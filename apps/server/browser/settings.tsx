import type { FormEvent, ReactElement } from 'react'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useTranslate } from 'val-i18n-react'

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

function SettingItem({
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
  placeholder,
  revision,
  secretLabel,
  secretRequired = true,
  source,
}: {
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
  readonly originLabel: string
  readonly placeholder: string
  readonly revision: number
  readonly secretLabel?: string
  readonly secretRequired?: boolean
  readonly source: (typeof sources)[number]
}): ReactElement {
  const [draftOrigin, setDraftOrigin] = useState(origin)
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [secret, setSecret] = useState('')
  const t = useTranslate()
  const managed = source == 'environment' || source == 'derived'
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
    if (draftOrigin.length == 0 || (secretLabel != null && secretRequired && secret.length == 0) || pending) return
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
                  <button className="server-button server-button-sm server-button-outline" disabled={pending} onClick={() => setRemoving(false)} type="button">
                    {t('settings.cancel')}
                  </button>
                  <button
                    className="server-button server-button-sm server-button-destructive"
                    disabled={pending}
                    onClick={() => void request('DELETE', { expectedRevision: revision, version: 1 })}
                    type="button"
                  >
                    {t('settings.delete')}
                  </button>
                </>
              ) : (
                <button className="server-button server-button-sm server-button-destructive" onClick={() => setRemoving(true)} type="button">
                  {t('settings.delete')}
                </button>
              ))}
            <button className="server-button server-button-sm server-button-outline" onClick={edit} type="button">
              {t(configured ? 'settings.edit' : 'settings.configure')}
            </button>
          </div>
        )}
      </div>
      {editing ? (
        <form className="settings-form" onSubmit={save}>
          <label htmlFor={`${endpoint}-origin`}>{originLabel}</label>
          <input
            autoComplete="url"
            autoFocus
            id={`${endpoint}-origin`}
            onChange={(event) => setDraftOrigin(event.target.value)}
            placeholder={placeholder}
            spellCheck={false}
            type="url"
            value={draftOrigin}
          />
          {secretLabel != null && (
            <>
              <label htmlFor={`${endpoint}-secret`}>{secretLabel}</label>
              <input
                autoComplete="new-password"
                id={`${endpoint}-secret`}
                onChange={(event) => setSecret(event.target.value)}
                spellCheck={false}
                type="password"
                value={secret}
              />
              <span className="settings-hint">{t(endpoint == '/config/integration' ? 'settings.callbackKeyHint' : 'settings.tokenHint')}</span>
            </>
          )}
          <div className="settings-form-actions">
            <button className="server-button server-button-outline" disabled={pending} onClick={() => setEditing(false)} type="button">
              {t('settings.cancel')}
            </button>
            <button
              className="server-button server-button-primary"
              disabled={pending || draftOrigin.length == 0 || (secretLabel != null && secretRequired && secret.length == 0)}
              type="submit"
            >
              {t('settings.save')}
            </button>
          </div>
        </form>
      ) : configured ? (
        <div className="settings-summary">
          <code>{origin}</code>
          {managed && <p>{t(source == 'environment' ? 'settings.environmentHint' : 'settings.derivedHint')}</p>}
        </div>
      ) : null}
    </div>
  )
}

export function SettingsPage({
  onConnectorChange,
  onUnauthorized,
}: {
  readonly onConnectorChange: () => void
  readonly onUnauthorized: () => void
}): ReactElement {
  const [current, setCurrent] = useState<NonNullable<ReturnType<typeof config>>>()
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)
  const t = useTranslate()

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const response = await fetch('/config', { credentials: 'same-origin' })
      if (response.status == 401) {
        onUnauthorized()
        return
      }
      const value = config(await response.json())
      if (!response.ok || value == null) throw new Error('Invalid configuration response.')
      setCurrent(value)
      setFailed(false)
    } catch {
      setFailed(true)
      toast.error(t('settings.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [onUnauthorized, t])

  useEffect(() => {
    void load()
    const refresh = (): void => void load()
    globalThis.addEventListener('focus', refresh)
    return () => globalThis.removeEventListener('focus', refresh)
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
                <button className="server-button server-button-outline" onClick={() => void load()} type="button">
                  {t('settings.retry')}
                </button>
              )}
            </div>
          </section>
        ) : (
          <>
            <section className="settings-section settings-group">
              <div className="settings-group-heading">
                <h2>{t('settings.connector')}</h2>
                <p>{t('settings.connectorDescription')}</p>
              </div>
              <SettingItem
                body={(origin, token) => ({ origin, token })}
                {...current.connector.runtime}
                description={t('settings.runtimeDescription')}
                endpoint="/config/connector"
                heading="h3"
                name={t('settings.runtime')}
                onConflict={load}
                onSaved={(value) => {
                  setCurrent(value)
                  onConnectorChange()
                }}
                onUnauthorized={onUnauthorized}
                originLabel={t('settings.origin')}
                placeholder="https://connector.example.com"
                revision={current.revision}
                secretLabel={t('settings.token')}
                secretRequired={false}
              />
              <SettingItem
                body={(origin) => ({ origin })}
                {...current.connector.console}
                description={t('settings.consoleDescription')}
                endpoint="/config/connector-console"
                heading="h3"
                name={t('settings.console')}
                onConflict={load}
                onSaved={setCurrent}
                onUnauthorized={onUnauthorized}
                originLabel={t('settings.console')}
                placeholder="https://console.example.com"
                revision={current.revision}
              />
            </section>
            <section className="settings-section">
              <SettingItem
                body={(origin, token) => ({ origin, token })}
                {...current.llm}
                endpoint="/config/llm"
                name="LLM"
                onConflict={load}
                onSaved={setCurrent}
                onUnauthorized={onUnauthorized}
                originLabel={t('settings.origin')}
                placeholder="https://llm.example.com"
                revision={current.revision}
                secretLabel={t('settings.token')}
              />
            </section>
            <section className="settings-section">
              <SettingItem
                body={(publicOrigin, callbackKey) => ({ callbackKey, publicOrigin })}
                {...current.integration}
                endpoint="/config/integration"
                name={t('settings.integration')}
                onConflict={load}
                onSaved={setCurrent}
                onUnauthorized={onUnauthorized}
                originLabel={t('settings.publicOrigin')}
                placeholder="https://flows.example.com"
                revision={current.revision}
                secretLabel={t('settings.callbackKey')}
              />
            </section>
          </>
        )}
      </div>
    </main>
  )
}
