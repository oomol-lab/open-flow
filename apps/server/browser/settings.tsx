import type { FormEvent, ReactElement } from 'react'
import type { ServiceProfileDraft } from '../common/service-profile.ts'
import type { SessionUser } from '../common/users.ts'

import { Button, Input, Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, HostTooltip } from '@oomol-lab/open-flow/ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Trans, useTranslate } from 'val-i18n-react'
import { validateLlmConfiguration, validateServiceProfile } from '../common/service-profile.ts'
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
  if (typeof p.connectorOrigin != 'string' || typeof p.consoleOrigin != 'string' || typeof p.connectorTokenConfigured != 'boolean') return
  return {
    connectorOrigin: p.connectorOrigin,
    consoleOrigin: p.consoleOrigin,
    connectorTokenConfigured: p.connectorTokenConfigured,
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
  const llmBody = body.llm as Record<string, unknown>
  const customLlm = llmBody.custom as Record<string, unknown> | undefined
  if (
    (llmBody.mode !== null && llmBody.mode != 'oomol' && llmBody.mode != 'custom') ||
    typeof llmBody.managed != 'boolean' ||
    typeof llmBody.oomolAvailable != 'boolean' ||
    typeof llmBody.oomolManaged != 'boolean' ||
    typeof customLlm?.origin != 'string' ||
    typeof customLlm.tokenConfigured != 'boolean'
  )
    return
  const profiles = services.profiles as Record<string, unknown> | undefined
  const oomol = serviceProfile(profiles?.oomol)
  const custom = serviceProfile(profiles?.custom)
  if (!oomol || !custom) return
  return {
    connector: { console, runtime },
    integration,
    llm: {
      ...llm,
      mode: llmBody.mode == 'oomol' ? ('oomol' as const) : llmBody.mode == 'custom' ? ('custom' as const) : null,
      managed: llmBody.managed,
      oomolAvailable: llmBody.oomolAvailable,
      oomolManaged: llmBody.oomolManaged,
      custom: { origin: customLlm.origin, tokenConfigured: customLlm.tokenConfigured },
    },
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
  disabled,
  saveFailed,
  onManual,
  onRetrySave,
  cancelRef,
  onPendingChange,
  onConflict,
  onAuthorized,
  onUnauthorized,
  revision,
}: {
  readonly disabled: boolean
  readonly saveFailed: boolean
  readonly onManual: () => void
  readonly onRetrySave: () => Promise<void>
  readonly cancelRef: { current: (() => void) | undefined }
  readonly onPendingChange: (pending: boolean) => void
  readonly onConflict: () => Promise<void>
  readonly onAuthorized: (value: { connectorOrigin: string; apiKey: string }) => void | Promise<void>
  readonly onUnauthorized: () => void
  readonly revision: number
}): ReactElement {
  const [starting, setStarting] = useState(false)
  const [login, setLogin] = useState<{ readonly code: string; readonly url: string }>()
  const [error, setError] = useState<'expired' | 'failed'>()
  const active = useRef<{ readonly controller: AbortController; readonly popup: Window | null; opened: boolean; id?: string }>()
  const heading = useRef<HTMLHeadingElement>(null)
  const primary = useRef<HTMLButtonElement>(null)
  const phase = disabled ? 'saving' : saveFailed ? 'saveFailed' : (error ?? (starting ? 'starting' : login ? 'waiting' : 'idle'))
  useEffect(() => {
    if (phase == 'idle') primary.current?.focus()
    else heading.current?.focus()
  }, [phase])
  const t = useTranslate()
  const endpoint = '/config/connector/oomol-login'

  const stop = useCallback((): void => {
    const operation = active.current
    active.current = undefined
    onPendingChange(false)
    setStarting(false)
    setLogin(undefined)
    operation?.controller.abort()
    if (operation != null && !operation.opened) operation.popup?.close()
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

  useEffect(() => {
    cancelRef.current = stop
    return () => {
      cancelRef.current = undefined
      stop()
    }
  }, [cancelRef, stop])

  async function connect(): Promise<void> {
    if (active.current != null) return
    const popup = window.open('about:blank', '_blank')
    if (popup != null) popup.opener = null
    const operation = { controller: new AbortController(), popup, opened: false, id: undefined as string | undefined }
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
      if (popup != null) {
        popup.location.replace(session.url)
        operation.opened = true
      }
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
      if (!operation.controller.signal.aborted) {
        setError((current) => current ?? 'failed')
      }
    } finally {
      if (active.current === operation) {
        stop()
      }
    }
  }

  const busy = starting || login != null
  const waiting = login != null && !disabled && !saveFailed
  const failed = !disabled && (error != null || saveFailed)
  const title = {
    idle: 'settings.oomolAutoAuthorize',
    starting: 'settings.oomolStarting',
    waiting: 'settings.oomolWaiting',
    saving: 'settings.oomolSaving',
    saveFailed: 'settings.oomolSaveFailed',
    expired: 'settings.oomolExpired',
    failed: 'settings.oomolFailed',
  } as const
  return (
    <>
      <div className="settings-oomol">
        <div className="settings-oomol-status" role={failed ? 'alert' : 'status'}>
          <div className="settings-oomol-status-icon" aria-hidden="true">
            <i
              className={
                failed
                  ? 'i-lucide-light:circle-alert size-5'
                  : busy || disabled
                    ? 'i-lucide-light:loader-circle size-5 motion-safe:animate-spin'
                    : 'i-lucide-light:key-round size-5'
              }
            />
          </div>
          <div className="min-w-0">
            <h3 ref={heading} tabIndex={-1} className="settings-oomol-heading">
              {t(title[phase])}
            </h3>
            <p className="host-hint">
              {t(
                disabled
                  ? 'settings.oomolSavingHint'
                  : saveFailed
                    ? 'settings.oomolSaveFailedHint'
                    : waiting
                      ? 'settings.oomolAuthorizeHint'
                      : 'settings.oomolAutoAuthorizeHint',
              )}
            </p>
          </div>
        </div>
        {waiting && (
          <div className="settings-oomol-verification">
            <div className="settings-oomol-code">
              <span className="host-hint">{t('settings.oomolCode')}</span>
              <code>{login.code}</code>
            </div>
            <p className="host-hint">{t('settings.oomolAutoSaveHint')}</p>
          </div>
        )}
      </div>
      {!disabled && (
        <DialogFooter className={saveFailed ? undefined : 'sm:flex-wrap sm:justify-between'}>
          {busy ? (
            <Button variant="outline" onClick={stop} type="button">
              {t('settings.oomolCancelAuthorization')}
            </Button>
          ) : !saveFailed ? (
            <Button variant="ghost" onClick={onManual} type="button">
              {t('settings.oomolManualKey')}
            </Button>
          ) : null}
          {waiting ? (
            <a className="settings-oomol-authorization-link" href={login.url} rel="noopener noreferrer" target="_blank">
              {t('settings.oomolOpenAuthorization')}
              <i aria-hidden="true" data-icon="inline-end" className="i-lucide-light:arrow-up-right size-4" />
            </a>
          ) : !busy ? (
            <Button ref={primary} onClick={() => void (saveFailed ? onRetrySave() : connect())} type="button">
              {t(saveFailed ? 'settings.oomolRetrySave' : error ? 'settings.oomolRetryAuthorize' : 'settings.oomolAutoAuthorize')}
            </Button>
          ) : null}
        </DialogFooter>
      )}
    </>
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
  originDescription,
  originHint,
  placeholder,
  revision,
  generateSecret = false,
  secretLabel,
  secretDescription,
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
  readonly originDescription?: string
  readonly originHint?: string
  readonly placeholder?: string
  readonly revision: number
  readonly generateSecret?: boolean
  readonly secretLabel?: string
  readonly secretDescription?: string
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
  const container = useRef<HTMLDivElement>(null)
  const originInput = useRef<HTMLInputElement>(null)
  const secretInput = useRef<HTMLInputElement>(null)
  const originError = !draftOrigin.trim() ? t('settings.validation.required') : !URL.canParse(draftOrigin) ? t('settings.validation.origin') : undefined
  const secretError =
    secretLabel == null
      ? undefined
      : secretRequired && !secret.trim()
        ? t('settings.validation.required')
        : endpoint == '/config/integration' && new TextEncoder().encode(secret).byteLength < 32
          ? t('settings.validation.callbackKey')
          : undefined
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
    if (pending) return
    if (originError || secretError) {
      const input = originError ? originInput : secretInput
      input.current?.focus()
      return
    }
    void request('PUT', { ...body(draftOrigin, secret), expectedRevision: revision, version: 1 })
  }

  return (
    <Dialog
      open={editing}
      onOpenChange={(open) => {
        if (!pending) setEditing(open)
      }}
    >
      <div ref={container} aria-busy={pending} className="settings-item">
        <div className="host-card-heading">
          <div className="host-card-heading-copy">
            <Heading>{name}</Heading>
            {description != null && <p>{description}</p>}
          </div>
          {!managed && (
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
              <DialogTrigger render={<Button variant="outline" size="sm" />} onClick={edit} type="button">
                {t(configured ? 'settings.edit' : 'settings.configure')}
              </DialogTrigger>
            </div>
          )}
        </div>
        <div className="host-card-body">
          {source != 'settings' && <p>{t(`settings.source.${source}`)}</p>}
          {configured && (
            <>
              {originLabel != null && <code>{origin}</code>}
              {summaryHint != null && source == 'settings' && <p>{summaryHint}</p>}
            </>
          )}
        </div>
        <DialogContent
          container={container.current}
          closeLabel={t('settings.cancel')}
          showCloseButton={!pending}
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl"
        >
          <DialogHeader>
            <DialogTitle>{name}</DialogTitle>
          </DialogHeader>
          <form className="host-field-feedback-scope grid gap-4" noValidate onSubmit={save}>
            {originLabel != null && (
              <HostField id={`${endpoint}-origin`} label={originLabel} description={originDescription}>
                <div className="host-field-control">
                  <Input
                    ref={originInput}
                    required
                    disabled={pending}
                    aria-invalid={originError != null}
                    autoComplete="url"
                    aria-describedby={
                      [
                        originDescription != null && `${endpoint}-origin-description`,
                        originHint != null && `${endpoint}-origin-hint`,
                        originError && `${endpoint}-origin-error`,
                      ]
                        .filter(Boolean)
                        .join(' ') || undefined
                    }
                    autoFocus
                    id={`${endpoint}-origin`}
                    onChange={(event) => setDraftOrigin(event.target.value)}
                    placeholder={placeholder}
                    spellCheck={false}
                    type="url"
                    value={draftOrigin}
                  />
                  {originError && (
                    <p className="host-field-error" id={`${endpoint}-origin-error`} role="alert">
                      {originError}
                    </p>
                  )}
                </div>
                {originHint != null && (
                  <span className="host-hint" id={`${endpoint}-origin-hint`}>
                    {originHint}
                  </span>
                )}
              </HostField>
            )}
            {secretLabel != null && (
              <HostField id={`${endpoint}-secret`} label={secretLabel} description={secretDescription}>
                <div className="flex items-start gap-2">
                  <div className="host-field-control min-w-0 flex-1">
                    <Input
                      ref={secretInput}
                      required={secretRequired}
                      disabled={pending}
                      aria-describedby={`${secretDescription != null ? `${endpoint}-secret-description ` : ''}${endpoint}-secret-hint${secretError ? ` ${endpoint}-secret-error` : ''}`}
                      aria-invalid={secretError != null}
                      autoFocus={originLabel == null}
                      autoComplete="new-password"
                      id={`${endpoint}-secret`}
                      onChange={(event) => setSecret(event.target.value)}
                      spellCheck={false}
                      type={generateSecret ? 'text' : 'password'}
                      value={secret}
                    />
                    {secretError && (
                      <p className="host-field-error" id={`${endpoint}-secret-error`} role="alert">
                        {secretError}
                      </p>
                    )}
                  </div>
                  {generateSecret && (
                    <Button variant="outline" disabled={pending} onClick={() => setSecret(randomCallbackKey())} type="button">
                      {t('settings.generateSecret')}
                    </Button>
                  )}
                </div>
                <span className="host-hint" id={`${endpoint}-secret-hint`}>
                  {secretHint ?? t(endpoint == '/config/integration' ? 'settings.callbackKeyHint' : 'settings.tokenHint')}
                </span>
              </HostField>
            )}
            <DialogFooter>
              <Button variant="outline" size="default" disabled={pending} onClick={() => setEditing(false)} type="button">
                {t('settings.cancel')}
              </Button>
              <Button variant="default" size="default" disabled={pending} type="submit">
                {t('settings.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </div>
    </Dialog>
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
  })
  const initial = useRef(draft)
  const [pending, setPending] = useState(false)
  const [authorizing, setAuthorizing] = useState(false)
  const [keyCleared, setKeyCleared] = useState(false)
  const [manual, setManual] = useState(false)
  const [authorizedDraft, setAuthorizedDraft] = useState<ServiceProfileDraft>()
  const cancelAuthorization = useRef<() => void>()
  const automatic = mode == 'oomol' && ['https://connector.oomol.com', 'https://connector.oomol.dev'].includes(new URL(draft.connectorOrigin).origin)
  const errors = validateServiceProfile(mode, {
    ...draft,
    connectorToken: draft.connectorToken || (profile.connectorTokenConfigured && !keyCleared ? 'stored' : ''),
  })
  const dirty =
    authorizedDraft != null || keyCleared || Object.keys(draft).some((key) => draft[key as keyof typeof draft] != initial.current[key as keyof typeof draft])
  const { guard, confirmation } = useUnsavedChanges({ dirty, pending, save, container })
  async function save(): Promise<boolean> {
    if (authorizing) return false
    return persist(authorizedDraft ?? draft)
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
            'API Key',
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
        ] as const)
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !pending) {
            cancelAuthorization.current?.()
            guard(onClose)
          }
        }}
      >
        <DialogContent
          container={container}
          closeLabel={t('settings.cancel')}
          showCloseButton={!pending}
          className={`max-h-[calc(100dvh-2rem)] overflow-y-auto ${mode == 'oomol' ? 'sm:max-w-md' : 'sm:max-w-xl'}`}
        >
          <DialogHeader>
            <DialogTitle>{t(mode == 'oomol' ? 'settings.oomolHosted' : 'settings.connectorCustom')}</DialogTitle>
          </DialogHeader>
          {automatic && !manual ? (
            <OomolConnectorLogin
              disabled={pending}
              saveFailed={authorizedDraft != null && !pending}
              cancelRef={cancelAuthorization}
              revision={current.revision}
              onConflict={onConflict}
              onUnauthorized={onUnauthorized}
              onPendingChange={setAuthorizing}
              onManual={() => setManual(true)}
              onRetrySave={async () => {
                if (await save()) onClose()
              }}
              onAuthorized={async ({ connectorOrigin, apiKey }) => {
                const nextDraft = { ...draft, connectorOrigin, connectorToken: apiKey }
                setAuthorizedDraft(nextDraft)
                if (await persist(nextDraft)) onClose()
              }}
            />
          ) : (
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
              <div className={`grid gap-4 ${mode == 'oomol' ? 'py-2' : ''}`}>
                {fields.map(([key, label, description, type, placeholder]) => {
                  const stored = key == 'connectorToken' && profile.connectorTokenConfigured && !keyCleared
                  const input = (
                    <div className="host-field-control group/api-key flex-1 min-w-0">
                      <Input
                        id={`service-${key}`}
                        name={key}
                        aria-invalid={errors[key] != null}
                        aria-describedby={`service-${key}-description${errors[key] ? ` service-${key}-error` : ''}`}
                        type={type}
                        autoFocus={mode == 'oomol'}
                        value={draft[key]}
                        placeholder={stored ? '••••••••' : placeholder}
                        autoComplete={type == 'password' ? 'off' : 'url'}
                        disabled={pending || authorizing}
                        className={mode == 'oomol' ? 'pr-9' : undefined}
                        required={key == 'connectorOrigin' || (key == 'connectorToken' && mode == 'oomol' && !stored)}
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
                  return (
                    <HostField key={key} id={`service-${key}`} label={label} description={description}>
                      {input}
                    </HostField>
                  )
                })}
              </div>
              <DialogFooter className={mode == 'oomol' ? 'sm:flex-wrap' : 'py-2'}>
                {automatic && (
                  <Button type="button" variant="ghost" className="sm:mr-auto" disabled={pending} onClick={() => setManual(false)}>
                    <i aria-hidden="true" data-icon="inline-start" className="i-lucide-light:arrow-left size-4" />
                    {t('settings.oomolBackToAuthorization')}
                  </Button>
                )}
                <div className={mode == 'oomol' ? 'flex flex-col-reverse gap-2 sm:ml-auto sm:flex-row' : 'contents'}>
                  <Button type="button" variant="outline" disabled={pending} onClick={() => guard(onClose)}>
                    {t('settings.cancel')}
                  </Button>
                  <Button type="submit" disabled={pending || authorizing}>
                    {t('settings.save')}
                  </Button>
                </div>
              </DialogFooter>
            </form>
          )}
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
    <section ref={container} className="host-card" aria-label={t('settings.connector')}>
      <div className="host-card-heading">
        <div className="host-card-heading-copy">
          <h2>{t('settings.connector')}</h2>
          <p>{t('settings.servicesDescription')}</p>
        </div>
        {missing && (
          <p className="settings-service-error" role="status">
            <i aria-hidden="true" className="i-lucide-light:triangle-alert size-4 shrink-0" />
            {t(current.services.mode == null ? 'settings.serviceSelectionRequired' : 'settings.serviceIncomplete')}
          </p>
        )}
      </div>
      <div className="host-card-body">
        <fieldset className="settings-service-options" disabled={pending || current.services.managed}>
          <legend className="sr-only">{t('settings.connectorMode')}</legend>
          {(['oomol', 'custom'] as const).map((mode) => (
            <div className="settings-service-option" key={mode} data-selected={current.services.mode == mode || undefined}>
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

function LlmSettings({
  current,
  onSaved,
  onConflict,
  onUnauthorized,
  onConnectorChange,
}: {
  readonly current: Configuration
  readonly onSaved: (value: Configuration) => void
  readonly onConflict: () => Promise<void>
  readonly onUnauthorized: () => void
  readonly onConnectorChange: () => void
}): ReactElement {
  const t = useTranslate()
  const container = useRef<HTMLElement>(null)
  const [editing, setEditing] = useState<ServiceMode>()
  const [pending, setPending] = useState(false)
  async function select(mode: ServiceMode): Promise<void> {
    if (pending || mode == current.llm.mode) return
    setPending(true)
    try {
      const response = await fetch('/config/llm/mode', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode, version: 1, expectedRevision: current.revision }),
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
      onSaved(value)
    } catch {
      toast.error(t('settings.saveFailed'))
    } finally {
      setPending(false)
    }
  }
  return (
    <section ref={container} className="host-card" aria-label={t('settings.llm')}>
      <div className="host-card-heading">
        <div className="host-card-heading-copy">
          <h2>{t('settings.llm')}</h2>
          <p>{t('settings.llmDescription')}</p>
        </div>
      </div>
      <div className="host-card-body">
        <fieldset className="settings-service-options" disabled={pending || current.llm.managed}>
          <legend className="sr-only">{t('settings.llmSource')}</legend>
          {(['oomol', 'custom'] as const).map((mode) => (
            <div className="settings-service-option" key={mode} data-selected={current.llm.mode == mode || undefined}>
              <label>
                <strong>{t(mode == 'oomol' ? 'settings.llmOomol' : 'settings.llmCustom')}</strong>
                <input
                  type="radio"
                  name="llm-mode"
                  value={mode}
                  checked={current.llm.mode == mode}
                  aria-describedby={`llm-${mode}-description`}
                  aria-invalid={current.llm.mode == mode && !current.llm.configured}
                  onChange={() => void select(mode)}
                />
              </label>
              <p id={`llm-${mode}-description`}>
                {t(mode == 'custom' ? 'settings.llmCustomHint' : current.llm.oomolAvailable ? 'settings.llmOomolHint' : 'settings.llmOomolUnavailable')}
              </p>
              <Button
                type="button"
                variant={current.llm.mode == mode && !current.llm.configured ? 'destructive' : 'outline'}
                size="sm"
                disabled={mode == 'oomol' && current.llm.oomolManaged}
                onClick={() => setEditing(mode)}
              >
                {t(
                  mode == 'oomol'
                    ? current.llm.oomolAvailable
                      ? 'settings.edit'
                      : 'settings.oomolConnect'
                    : current.llm.custom.tokenConfigured
                      ? 'settings.edit'
                      : 'settings.configure',
                )}
              </Button>
            </div>
          ))}
        </fieldset>
      </div>
      {current.llm.managed && <p className="settings-service-note">{t('settings.environmentHint')}</p>}
      {editing == 'custom' && (
        <LlmEditor
          current={current}
          onSaved={onSaved}
          onConflict={onConflict}
          onUnauthorized={onUnauthorized}
          container={container.current}
          onClose={() => setEditing(undefined)}
        />
      )}
      {editing == 'oomol' && (
        <ServiceEditor
          mode="oomol"
          current={current}
          container={container.current}
          onConflict={onConflict}
          onUnauthorized={onUnauthorized}
          onClose={() => setEditing(undefined)}
          onSaved={(value) => {
            onSaved(value)
            onConnectorChange()
          }}
        />
      )}
    </section>
  )
}

function LlmEditor({
  current,
  onSaved,
  onConflict,
  onUnauthorized,
  container,
  onClose,
}: {
  readonly current: Configuration
  readonly onSaved: (value: Configuration) => void
  readonly onConflict: () => Promise<void>
  readonly onUnauthorized: () => void
  readonly container: HTMLElement | null
  readonly onClose: () => void
}): ReactElement {
  const t = useTranslate()
  const originInput = useRef<HTMLInputElement>(null)
  const tokenInput = useRef<HTMLInputElement>(null)
  const [origin, setOrigin] = useState(current.llm.custom.origin)
  const [token, setToken] = useState('')
  const [pending, setPending] = useState(false)
  const dirty = origin != current.llm.custom.origin || token != ''
  const tokenUpdate = token == '' && current.llm.custom.tokenConfigured ? null : token
  const errors = validateLlmConfiguration(origin, tokenUpdate)
  const { guard, confirmation } = useUnsavedChanges({ dirty, pending, save, container })
  async function save(): Promise<boolean> {
    if (pending || current.llm.managed) return false
    if (errors.origin || errors.token) {
      const input = errors.origin ? originInput : tokenInput
      input.current?.focus()
      return false
    }
    setPending(true)
    try {
      const response = await fetch('/config/llm/custom', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          version: 1,
          expectedRevision: current.revision,
          origin,
          token: tokenUpdate,
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
      onClose()
      posthog?.capture('configuration_saved', { configuration_type: 'llm' })
      return true
    } catch {
      toast.error(t('settings.saveFailed'))
      return false
    } finally {
      setPending(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) guard(onClose)
      }}
    >
      <DialogContent
        container={container}
        closeLabel={t('settings.cancel')}
        showCloseButton={!pending}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl"
      >
        <DialogHeader>
          <DialogTitle>{t('settings.llmCustom')}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4 host-field-feedback-scope"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <HostField id="llm-origin" label={t('settings.llmAddress')}>
            <div className="host-field-control">
              <Input
                ref={originInput}
                id="llm-origin"
                type="url"
                autoComplete="url"
                autoFocus
                spellCheck={false}
                placeholder="https://llm.example.com"
                required
                disabled={pending}
                value={origin}
                aria-invalid={errors.origin != null}
                aria-describedby={errors.origin ? 'llm-origin-error' : undefined}
                onChange={(event) => setOrigin(event.target.value)}
              />
              {errors.origin && (
                <p id="llm-origin-error" className="host-field-error" role="alert">
                  {t(`settings.validation.${errors.origin}`)}
                </p>
              )}
            </div>
          </HostField>
          <HostField id="llm-token" label={t('settings.llmToken')}>
            <div className="host-field-control">
              <Input
                ref={tokenInput}
                id="llm-token"
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                required={!current.llm.custom.tokenConfigured}
                disabled={pending}
                value={token}
                placeholder={current.llm.custom.tokenConfigured ? '••••••••' : ''}
                aria-invalid={errors.token != null}
                aria-describedby={errors.token ? 'llm-token-error' : undefined}
                onChange={(event) => setToken(event.target.value)}
              />
              {errors.token && (
                <p id="llm-token-error" className="host-field-error" role="alert">
                  {t(`settings.validation.${errors.token}`)}
                </p>
              )}
            </div>
          </HostField>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => guard(onClose)}>
              {t('settings.cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {t('settings.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
      {confirmation}
    </Dialog>
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
    (current.services.mode == null || !current.connector.runtime.configured || (current.services.mode == 'oomol' && !current.connector.runtime.tokenConfigured))
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
          <LlmSettings current={current} onConflict={load} onConnectorChange={onConnectorChange} onSaved={saved} onUnauthorized={onUnauthorized} />
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
              originDescription={t('settings.integrationDescription')}
              originHint={t('settings.publicOriginHint')}
              placeholder="https://flows.example.com"
              revision={current.revision}
              generateSecret
              secretLabel={t('settings.callbackKey')}
              secretDescription={t('settings.callbackKeyDescription')}
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
