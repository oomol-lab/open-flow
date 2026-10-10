import type { FormEvent, ReactElement } from 'react'
import type { ServiceProfileDraft } from '../common/service-profile.ts'
import type { SessionUser } from '../common/users.ts'

import { Button, Input, Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, HostTooltip } from '@oomol-lab/open-flow/ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Trans, useTranslate } from 'val-i18n-react'
import { validateServiceProfile } from '../common/service-profile.ts'
import { HostPage, HostField } from './host-ui.tsx'
import { posthog } from './posthog.ts'
import { useUnsavedChanges } from './unsaved-changes.tsx'

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

function serviceProfile(value: unknown) {
  if (value == null || typeof value != 'object') return
  const p = value as Record<string, unknown>
  if (
    typeof p.connectorOrigin != 'string' ||
    typeof p.consoleOrigin != 'string' ||
    typeof p.llmOrigin != 'string' ||
    typeof p.connectorTokenConfigured != 'boolean' ||
    typeof p.llmTokenConfigured != 'boolean'
  )
    return
  return {
    connectorOrigin: p.connectorOrigin,
    consoleOrigin: p.consoleOrigin,
    llmOrigin: p.llmOrigin,
    connectorTokenConfigured: p.connectorTokenConfigured,
    llmTokenConfigured: p.llmTokenConfigured,
  }
}
function config(value: unknown) {
  if (value == null || typeof value != 'object' || Array.isArray(value)) return
  const body = value as Record<string, unknown>
  if (body.version !== 1 || !Number.isSafeInteger(body.revision) || body.connector == null || typeof body.connector != 'object') return
  if (body.services == null || typeof body.services != 'object') return
  const services = body.services as Record<string, unknown>
  if ((services.mode !== null && services.mode != 'oomol' && services.mode != 'custom') || typeof services.managed != 'boolean') return
  const connector = body.connector as Record<string, unknown>
  const runtime = setting(connector.runtime, 'origin', true)
  const console = setting(connector.console, 'origin', false)
  const integration = setting(body.integration, 'publicOrigin', false)
  const llm = setting(body.llm, 'origin', true)
  if (runtime == null || console == null || integration == null || llm == null) return
  const profiles = services.profiles as Record<string, unknown> | undefined
  const oomol = serviceProfile(profiles?.oomol)
  const custom = serviceProfile(profiles?.custom)
  if (!oomol || !custom) return
  return {
    connector: { console, runtime },
    integration,
    llm,
    revision: Number(body.revision),
    services: { mode: services.mode, managed: services.managed, profiles: { oomol, custom } },
  }
}

function randomCallbackKey(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function OomolConnectorLogin({
  children,
  disabled,
  onPendingChange,
  onConflict,
  onAuthorized,
  onUnauthorized,
  revision,
}: {
  readonly children?: ReactElement
  readonly disabled?: boolean
  readonly onPendingChange: (pending: boolean) => void
  readonly onConflict: () => Promise<void>
  readonly onAuthorized: (value: { connectorOrigin: string; apiKey: string }) => void | Promise<void>
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
    onPendingChange(false)
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
  }, [onPendingChange])

  useEffect(() => stop, [stop])

  async function connect(): Promise<void> {
    if (active.current != null) return
    const popup = window.open('about:blank', '_blank')
    if (popup != null) popup.opener = null
    const operation = { controller: new AbortController(), id: undefined as string | undefined }
    active.current = operation
    setStarting(true)
    onPendingChange(true)
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
        if (result.status == 'authorized') {
          if (typeof result.connectorOrigin != 'string' || typeof result.apiKey != 'string' || result.apiKey.length == 0)
            throw new Error('Invalid authorization response.')
          operation.id = undefined
          await onAuthorized({ connectorOrigin: result.connectorOrigin, apiKey: result.apiKey })
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
      <div className="flex items-center gap-2">
        {children}
        <Button variant="default" disabled={disabled || starting || login != null} onClick={() => void connect()} type="button">
          <i aria-hidden="true" data-icon="inline-start" className="i-lucide-light:key-round size-4 shrink-0" />
          {t(starting ? 'settings.oomolStarting' : 'settings.oomolAutoAuthorize')}
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
      <div className="host-card-heading">
        <div className="host-card-heading-copy">
          <Heading>{name}</Heading>
          {description != null && <p>{description}</p>}
        </div>
        {!managed && !editing && (
          <div className="host-actions">
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
      <div className="host-card-body">
        {source != 'settings' && <p>{t(`settings.source.${source}`)}</p>}
        {!editing && configured && (
          <>
            {originLabel != null && <code>{origin}</code>}
            {summaryHint != null && source == 'settings' && <p>{summaryHint}</p>}
          </>
        )}
      </div>
      {editing && (
        <form className="host-form" onSubmit={save}>
          {originLabel != null && (
            <HostField id={`${endpoint}-origin`} label={originLabel}>
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
            </HostField>
          )}
          {originHint != null && (
            <span className="host-hint" id={`${endpoint}-origin-hint`}>
              {originHint}
            </span>
          )}
          {secretLabel != null && (
            <HostField
              id={`${endpoint}-secret`}
              label={secretLabel}
              action={
                generateSecret && (
                  <Button variant="outline" size="sm" disabled={pending} onClick={() => setSecret(randomCallbackKey())} type="button">
                    {t('settings.generateSecret')}
                  </Button>
                )
              }
            >
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
              <span className="host-hint" id={`${endpoint}-secret-hint`}>
                {secretHint ?? t(endpoint == '/config/integration' ? 'settings.callbackKeyHint' : 'settings.tokenHint')}
              </span>
            </HostField>
          )}
          <div className="host-form-actions">
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
      )}
    </div>
  )
}

type ServiceMode = 'oomol' | 'custom'
type Configuration = NonNullable<ReturnType<typeof config>>

function ServiceEditor({
  mode,
  current,
  onSaved,
  onConflict,
  onUnauthorized,
  onClose,
  container,
}: {
  readonly mode: ServiceMode
  readonly current: Configuration
  readonly onSaved: (value: Configuration) => void
  readonly onConflict: () => Promise<void>
  readonly onUnauthorized: () => void
  readonly onClose: () => void
  readonly container: HTMLElement | null
}): ReactElement {
  const t = useTranslate()
  const profile = current.services.profiles[mode]
  const [draft, setDraft] = useState({
    connectorOrigin: profile.connectorOrigin || (mode == 'oomol' ? 'https://connector.oomol.com' : ''),
    connectorToken: '',
    consoleOrigin: profile.consoleOrigin,
    llmOrigin: profile.llmOrigin,
    llmToken: '',
  })
  const initial = useRef(draft)
  const [pending, setPending] = useState(false)
  const [authorizing, setAuthorizing] = useState(false)
  const [keyCleared, setKeyCleared] = useState(false)
  const errors = validateServiceProfile(mode, {
    ...draft,
    connectorToken: draft.connectorToken || (profile.connectorTokenConfigured && !keyCleared ? 'stored' : ''),
    llmToken: draft.llmToken || (profile.llmTokenConfigured ? 'stored' : ''),
  })
  const dirty = keyCleared || Object.keys(draft).some((key) => draft[key as keyof typeof draft] != initial.current[key as keyof typeof draft])
  const { guard, confirmation } = useUnsavedChanges({ dirty, pending, save, container })
  async function save(): Promise<boolean> {
    if (authorizing) return false
    return persist(draft)
  }
  async function persist(nextDraft: ServiceProfileDraft): Promise<boolean> {
    const issues = validateServiceProfile(mode, nextDraft)
    if (pending || Object.values(issues).some((issue) => issue != 'required')) return false
    setPending(true)
    try {
      const response = await fetch(`/config/services/${mode}`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...nextDraft,
          connectorToken: nextDraft.connectorToken == '' && profile.connectorTokenConfigured && !keyCleared ? null : nextDraft.connectorToken,
          llmToken: nextDraft.llmToken == '' && profile.llmTokenConfigured ? null : nextDraft.llmToken,
          expectedRevision: current.revision,
          version: 1,
        }),
      })
      if (response.status == 401) {
        onUnauthorized()
        return false
      }
      if (response.status == 409) {
        toast.error(t('settings.changed'))
        await onConflict()
        return false
      }
      const value = config(await response.json())
      if (!response.ok || value == null) throw new Error('Invalid configuration response.')
      onSaved(value)
      return true
    } catch {
      toast.error(t('settings.saveFailed'))
      return false
    } finally {
      setPending(false)
    }
  }
  const fields =
    mode == 'oomol'
      ? ([
          [
            'connectorToken',
            'API key',
            <Trans message={t('settings.oomolKeyHelp')}>
              <a href="https://console.oomol.com/api-key" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
                OOMOL API key
              </a>
            </Trans>,
            'password',
            '',
          ],
        ] as const)
      : ([
          ['connectorOrigin', t('settings.connectorAddress'), t('settings.connectorAddressHelp'), 'url', 'https://connector.example.com'],
          ['connectorToken', t('settings.connectorToken'), t('settings.connectorTokenHelp'), 'password', ''],
          ['consoleOrigin', t('settings.console'), t('settings.consoleAddressHelp'), 'url', 'https://console.example.com'],
          ['llmOrigin', t('settings.llmAddress'), t('settings.llmAddressHelp'), 'url', 'https://llm.example.com'],
          ['llmToken', t('settings.llmToken'), t('settings.llmTokenHelp'), 'password', ''],
        ] as const)
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) guard(onClose)
        }}
      >
        <DialogContent
          container={container}
          closeLabel={t('settings.cancel')}
          showCloseButton={!pending}
          className="sm:max-w-xl max-h-[calc(100dvh-2rem)] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle>{t(mode == 'oomol' ? 'settings.oomolHosted' : 'settings.connectorCustom')}</DialogTitle>
          </DialogHeader>
          <form
            noValidate
            className="host-field-feedback-scope grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              void save().then((saved) => {
                if (saved) onClose()
              })
            }}
          >
            {fields.map(([key, label, description, type, placeholder]) => {
              const stored = key == 'connectorToken' ? profile.connectorTokenConfigured && !keyCleared : key == 'llmToken' && profile.llmTokenConfigured
              const input = (
                <div className="host-field-control group/api-key flex-1 min-w-0">
                  <Input
                    id={`service-${key}`}
                    name={key}
                    aria-invalid={errors[key] != null}
                    aria-describedby={`service-${key}-description${errors[key] ? ` service-${key}-error` : ''}`}
                    type={type}
                    value={draft[key]}
                    placeholder={stored ? '••••••••' : placeholder}
                    autoComplete={type == 'password' ? 'off' : 'url'}
                    disabled={pending || authorizing}
                    className={mode == 'oomol' ? 'pr-9' : undefined}
                    required={
                      key == 'connectorOrigin' ||
                      (key == 'connectorToken' && mode == 'oomol' && !stored) ||
                      (key == 'llmToken' && draft.llmOrigin != '' && !stored)
                    }
                    onChange={(event) => setDraft({ ...draft, [key]: event.currentTarget.value })}
                  />
                  {mode == 'oomol' && (draft.connectorToken != '' || stored) && (
                    <HostTooltip label={t('settings.clearApiKey')}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="absolute right-0.5 inset-y-0 my-auto invisible group-hover/api-key:visible group-focus-within/api-key:visible"
                        aria-label={t('settings.clearApiKey')}
                        disabled={pending || authorizing}
                        onClick={() => {
                          setKeyCleared(profile.connectorTokenConfigured)
                          setDraft({ ...draft, connectorToken: '' })
                        }}
                      >
                        <i aria-hidden="true" className="i-lucide-light:x size-4" />
                      </Button>
                    </HostTooltip>
                  )}
                  {errors[key] && (
                    <p className="host-field-error" id={`service-${key}-error`} role="alert">
                      {t(`settings.validation.${errors[key]}`)}
                    </p>
                  )}
                </div>
              )
              const automatic =
                mode == 'oomol' && ['https://connector.oomol.com', 'https://connector.oomol.dev'].includes(new URL(draft.connectorOrigin).origin)
              return (
                <HostField key={key} id={`service-${key}`} label={label} description={description}>
                  {automatic ? (
                    <OomolConnectorLogin
                      disabled={pending}
                      revision={current.revision}
                      onConflict={onConflict}
                      onUnauthorized={onUnauthorized}
                      onPendingChange={setAuthorizing}
                      onAuthorized={async ({ connectorOrigin, apiKey }) => {
                        const authorizedDraft = { ...draft, connectorOrigin, connectorToken: apiKey }
                        setKeyCleared(false)
                        setDraft(authorizedDraft)
                        if (await persist(authorizedDraft)) onClose()
                      }}
                    >
                      {input}
                    </OomolConnectorLogin>
                  ) : (
                    input
                  )}
                </HostField>
              )
            })}
            <DialogFooter className="py-2">
              <Button type="button" variant="outline" disabled={pending} onClick={() => guard(onClose)}>
                {t('settings.cancel')}
              </Button>
              <Button type="submit" disabled={pending || authorizing}>
                {t('settings.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
        {confirmation}
      </Dialog>
    </>
  )
}

function ConnectorSettings({
  current,
  onConflict,
  onConnectorChange,
  onSaved,
  onUnauthorized,
}: {
  readonly current: Configuration
  readonly onConflict: () => Promise<void>
  readonly onConnectorChange: () => void
  readonly onSaved: (value: Configuration) => void
  readonly onUnauthorized: () => void
}): ReactElement {
  const t = useTranslate()
  const [editing, setEditing] = useState<ServiceMode>()
  const [pending, setPending] = useState(false)
  const container = useRef<HTMLElement>(null)
  const missing = serviceConfigurationMissing(current)
  const saved = (value: Configuration): void => {
    onSaved(value)
    onConnectorChange()
  }
  async function select(mode: ServiceMode): Promise<void> {
    if (pending || mode == current.services.mode) return
    setPending(true)
    try {
      const response = await fetch('/config/services/mode', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode, expectedRevision: current.revision, version: 1 }),
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
      saved(value)
    } catch {
      toast.error(t('settings.saveFailed'))
    } finally {
      setPending(false)
    }
  }
  return (
    <section ref={container} className="host-card" aria-label={t('settings.services')}>
      <div className="host-card-heading">
        <div className="host-card-heading-copy">
          <h2>{t('settings.services')}</h2>
          <p>{t('settings.servicesDescription')}</p>
        </div>
        {missing && (
          <p className="settings-service-error" role="status">
            <i aria-hidden="true" className="i-lucide-light:triangle-alert size-4 shrink-0" />
            {t('settings.serviceIncomplete')}
          </p>
        )}
      </div>
      <div className="host-card-body">
        <fieldset className="settings-service-options" disabled={pending || current.services.managed}>
          <legend className="sr-only">{t('settings.connectorMode')}</legend>
          {(['oomol', 'custom'] as const).map((mode) => (
            <div
              className="settings-service-option"
              key={mode}
              data-selected={current.services.mode == mode || undefined}
              data-danger={(current.services.mode == mode && missing) || undefined}
            >
              <label>
                <strong>{t(mode == 'oomol' ? 'settings.oomolHosted' : 'settings.connectorCustom')}</strong>
                <input
                  type="radio"
                  name="connector-mode"
                  value={mode}
                  aria-describedby={`service-${mode}-description`}
                  checked={current.services.mode == mode}
                  aria-invalid={current.services.mode == mode && missing}
                  onChange={() => void select(mode)}
                />
              </label>
              <p id={`service-${mode}-description`}>{t(mode == 'oomol' ? 'settings.hostedIncludes' : 'settings.selfHostedDescription')}</p>
              <Button variant={current.services.mode == mode && missing ? 'destructive' : 'outline'} size="sm" type="button" onClick={() => setEditing(mode)}>
                {t('settings.edit')}
              </Button>
            </div>
          ))}
        </fieldset>
      </div>
      {current.services.managed && <p className="settings-service-note">{t('settings.environmentHint')}</p>}
      {editing && (
        <ServiceEditor
          mode={editing}
          current={current}
          onSaved={saved}
          onConflict={onConflict}
          onUnauthorized={onUnauthorized}
          onClose={() => setEditing(undefined)}
          container={container.current}
        />
      )}
    </section>
  )
}

export function useConfiguration(onUnauthorized: () => void, enabled = true) {
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
    if (!enabled) return
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
  }, [enabled, onUnauthorized, t])

  useEffect(() => {
    if (!enabled) {
      setCurrent(undefined)
      setLoading(true)
      setFailed(false)
      return
    }
    void load()
    const refresh = (): void => void load()
    globalThis.addEventListener('focus', refresh)
    return () => {
      loadSequence.current += 1
      globalThis.removeEventListener('focus', refresh)
    }
  }, [enabled, load])

  return { current, failed, loading, load, saved, setLoading }
}

export function serviceConfigurationMissing(current: Configuration | undefined): boolean {
  return (
    current != null &&
    current.services.mode != null &&
    (!current.connector.runtime.configured ||
      ((current.services.mode == 'oomol' || current.services.profiles.custom.llmOrigin != '') && !current.llm.configured))
  )
}

export function SettingsPage({
  user,
  configuration,
  onSignOut,
  onConnectorChange,
  onUnauthorized,
}: {
  readonly user: SessionUser
  readonly configuration: ReturnType<typeof useConfiguration>
  readonly onSignOut: () => void
  readonly onConnectorChange: () => void
  readonly onUnauthorized: () => void
}): ReactElement {
  const { current, failed, loading, load, saved, setLoading } = configuration
  const t = useTranslate()
  return (
    <HostPage>
      <header className="host-page-header">
        <h1>{t('settings.title')}</h1>
      </header>
      {loading || current == null ? (
        <section className="host-card">
          <div className="host-state" role={failed ? 'alert' : undefined}>
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
          <section className="host-card">
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
      <SessionCard user={user} onSignOut={onSignOut} />
    </HostPage>
  )
}

export function SessionCard({ user, onSignOut }: { readonly user: SessionUser; readonly onSignOut: () => void }): ReactElement {
  const t = useTranslate()
  return (
    <section className="host-card" aria-labelledby="settings-session-title">
      <div className="host-card-heading">
        <div className="host-card-heading-copy">
          <h2 id="settings-session-title">{t('settings.session')}</h2>
          <p>
            {t(`users.${user.role}`)}
            {user.email != null && <> · {user.email}</>}
          </p>
        </div>
        <Button variant="outline" size="sm" type="button" onClick={onSignOut}>
          {t('session.signOut')}
        </Button>
      </div>
    </section>
  )
}

export function MemberSettingsPage({ user, onSignOut }: { readonly user: SessionUser; readonly onSignOut: () => void }): ReactElement {
  const t = useTranslate()
  return (
    <HostPage>
      <header className="host-page-header">
        <h1>{t('shell.memberSettings')}</h1>
      </header>
      <SessionCard user={user} onSignOut={onSignOut} />
    </HostPage>
  )
}
