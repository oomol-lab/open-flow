import type { FormEvent } from 'react'
import type { ConnectorConnection, ControlClient, EventSource } from '../../../control/common/api.ts'
import type { UiLanguage } from '../../../localization/common/languages.ts'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { I18nProvider, useTranslate } from 'val-i18n-react'
import { Button, buttonVariants } from '../../../ui/browser/button.tsx'
import { Checkbox } from '../../../ui/browser/checkbox.tsx'
import { Input } from '../../../ui/browser/input.tsx'
import { Label } from '../../../ui/browser/label.tsx'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '../../../ui/browser/select.tsx'
import { EventSourceSetup } from './eventSourceSetup.tsx'
import { FeishuEventPicker } from './feishuEventPicker.tsx'
import { createI18n } from './i18n.ts'
import { errorNotice } from './stores/workbenchNotice.ts'

interface Props {
  readonly client: Pick<
    ControlClient,
    'listEventSources' | 'createEventSource' | 'updateEventSource' | 'deleteEventSource' | 'listEventSourceConnections' | 'createConnectorConnectionPage'
  >
  readonly language: UiLanguage
  readonly teams: readonly { readonly id: string; readonly name: string }[]
}

export function EventSourcesPage(props: Props) {
  const i18n = useMemo(() => createI18n(props.language), [props.language])
  return (
    <I18nProvider i18n={i18n}>
      <EventSources {...props} />
    </I18nProvider>
  )
}

function EventSources({ client, teams }: Props) {
  const t = useTranslate()
  const [sources, setSources] = useState<readonly EventSource[]>()
  const [error, setError] = useState<string>()
  const [editing, setEditing] = useState<EventSource | 'new'>()
  const [removing, setRemoving] = useState<string>()
  const [pending, setPending] = useState(false)
  const sequence = useRef(0)
  const load = useCallback(async () => {
    const current = ++sequence.current
    setError(undefined)
    try {
      const result = await client.listEventSources()
      if (current == sequence.current) setSources(result.sources)
    } catch (cause) {
      if (current == sequence.current) setError(errorNotice(cause, t).message)
    }
  }, [client, t])
  useEffect(() => {
    void load()
    return () => {
      sequence.current += 1
    }
  }, [load])

  async function toggle(source: EventSource) {
    setPending(true)
    try {
      await client.updateEventSource(source.sourceId, {
        version: 1,
        expectedRevision: source.revision,
        name: source.name,
        enabled: !source.enabled,
        eventTypes: source.eventTypes,
      })
      await load()
    } catch (cause) {
      setError(errorNotice(cause, t).message)
    } finally {
      setPending(false)
    }
  }

  async function remove(source: EventSource) {
    setPending(true)
    try {
      await client.deleteEventSource(source.sourceId, source.revision)
      setRemoving(undefined)
      await load()
    } catch (cause) {
      setError(errorNotice(cause, t).message)
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="h-full w-full overflow-auto bg-background px-6 pt-8 pb-16 text-sm text-foreground">
      <div className="mx-auto flex max-w-[720px] flex-col gap-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="m-0 text-2xl leading-8 font-semibold">{t('eventSources.title')}</h1>
            <p className="m-0 mt-2 text-sm leading-5 text-muted-foreground">{t('eventSources.description')}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void load()} disabled={pending}>
              {t('eventSources.refresh')}
            </Button>
            <Button onClick={() => setEditing('new')} disabled={sources == null || editing != null || pending}>
              {t('eventSources.add')}
            </Button>
          </div>
        </header>
        {error != null && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {sources == null && error == null && <p role="status">{t('eventSources.loading')}</p>}
        {editing != null && (
          <SourceForm
            existingNames={sources?.map((source) => source.name)}
            key={editing == 'new' ? 'new' : editing.sourceId}
            source={editing == 'new' ? undefined : editing}
            client={client}
            teams={teams}
            onCancel={() => setEditing(undefined)}
            onSaved={() => {
              setEditing(undefined)
              void load()
            }}
          />
        )}
        {sources?.length == 0 && editing == null && (
          <section className="rounded-lg border border-border p-6">
            <h2 className="m-0 text-base leading-6 font-medium">{t('eventSources.empty')}</h2>
            <p className="m-0 mt-2 text-sm leading-5 text-muted-foreground">{t('eventSources.emptyDescription')}</p>
          </section>
        )}
        {sources?.map((source) => (
          <section key={source.sourceId} className="flex flex-col gap-4 rounded-lg border border-border p-5" aria-label={source.name}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="m-0 text-base leading-6 font-medium">{source.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {source.appId} ·{' '}
                  {t(
                    source.enabled
                      ? source.verifiedAt == null
                        ? 'eventSources.unverified'
                        : source.lastReceivedAt == null
                          ? 'eventSources.ready'
                          : 'eventSources.receiving'
                      : 'eventSources.disabled',
                  )}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={pending} onClick={() => setEditing(source)}>
                  {t('eventSources.edit')}
                </Button>
                <Button variant="outline" size="sm" disabled={pending} onClick={() => void toggle(source)}>
                  {t(source.enabled ? 'eventSources.disable' : 'eventSources.enable')}
                </Button>
              </div>
            </div>
            <EventSourceSetup
              source={source}
              client={client}
              onChange={(updated) => setSources((current) => current?.map((item) => (item.sourceId == updated.sourceId ? updated : item)))}
            />
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">{t('eventSources.connection')}</dt>
                <dd className="break-all">{source.connectionId}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('eventSources.lastReceived')}</dt>
                <dd>{source.lastReceivedAt == null ? t('eventSources.never') : new Date(source.lastReceivedAt).toLocaleString()}</dd>
              </div>
            </dl>
            <div>
              <h3 className="text-sm font-medium">{t('eventSources.consumers')}</h3>
              {source.consumers.length == 0 ? (
                <p className="mt-1 text-sm text-muted-foreground">{t('eventSources.noConsumers')}</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {source.consumers.map((consumer) => (
                    <li className="text-sm" key={`${consumer.flowId}:${consumer.triggerNodeId}`}>
                      {consumer.flowName} · {consumer.triggerNodeId}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex items-center gap-2">
              {removing == source.sourceId ? (
                <>
                  <span className="text-sm">{t('eventSources.deleteConfirm')}</span>
                  <Button variant="destructive" size="sm" disabled={pending} onClick={() => void remove(source)}>
                    {t('eventSources.delete')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setRemoving(undefined)}>
                    {t('eventSources.cancel')}
                  </Button>
                </>
              ) : (
                <Button variant="ghost" size="sm" disabled={pending || source.consumers.length > 0} onClick={() => setRemoving(source.sourceId)}>
                  {t('eventSources.delete')}
                </Button>
              )}
            </div>
          </section>
        ))}
      </div>
    </main>
  )
}

export function SourceForm({
  source,
  existingNames = [],
  fixedTeamId,
  onPendingChange,
  client,
  teams,
  onSaved,
  onCancel,
}: Omit<Props, 'language'> & {
  readonly source?: EventSource
  readonly existingNames?: readonly string[]
  readonly onPendingChange?: (pending: boolean) => void
  readonly fixedTeamId?: string | null
  readonly onSaved: (source: EventSource) => void
  readonly onCancel: () => void
}) {
  const t = useTranslate()
  const [step, setStep] = useState(source == null ? 1 : 2)
  const [name, setName] = useState(source?.name ?? t('eventSources.defaultName'))
  const [nameEdited, setNameEdited] = useState(false)
  const [teamId, setTeamId] = useState(source?.teamId ?? fixedTeamId ?? teams[0]?.id ?? '')
  const [connectionId, setConnectionId] = useState(source?.connectionId ?? '')
  const [connections, setConnections] = useState<readonly ConnectorConnection[]>()
  const [connectionError, setConnectionError] = useState<string>()
  const [connectionPage, setConnectionPage] = useState<string>()
  const [pageError, setPageError] = useState<string>()
  const connecting = useRef(false)
  const [attempt, setAttempt] = useState(0)
  const [token, setToken] = useState('')
  const [key, setKey] = useState('')
  const [events, setEvents] = useState<string[]>(source?.eventTypes ?? ['im.message.receive_v1'])
  const [managed, setManaged] = useState(source?.manageSubscriptions ?? false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (source != null) return
    const controller = new AbortController()
    setConnections(undefined)
    setConnectionError(undefined)
    void client.listEventSourceConnections(teamId || null, controller.signal).then(
      (items) => {
        if (!controller.signal.aborted) setConnections(items)
      },
      (cause) => {
        if (!controller.signal.aborted) setConnectionError(errorNotice(cause, t).message)
      },
    )
    return () => controller.abort()
  }, [client, source, teamId, attempt, t])
  useEffect(() => {
    if (source != null) return
    let current = true
    setPageError(undefined)
    setConnectionPage(undefined)
    void client.createConnectorConnectionPage('feishu_app_bot', undefined, teamId || undefined).then(
      (url) => {
        if (current) setConnectionPage(url)
      },
      (cause) => {
        if (current) setPageError(errorNotice(cause, t).message)
      },
    )
    return () => {
      current = false
    }
  }, [client, source, teamId, attempt, t])
  useEffect(() => {
    const refreshAfterConnection = () => {
      if (!connecting.current) return
      connecting.current = false
      setAttempt((value) => value + 1)
    }
    window.addEventListener('focus', refreshAfterConnection)
    return () => window.removeEventListener('focus', refreshAfterConnection)
  }, [])
  const connection = connections?.find((item) => item.connectionId == connectionId && item.status == 'active')
  const appId = source?.appId ?? connection?.providerAccountId
  const identified = appId != null && /^cli_[a-zA-Z0-9]+$/.test(appId)
  function selectApp(value: string) {
    setConnectionId(value)
    if (nameEdited) return
    const app = connections?.find((item) => item.connectionId == value)
    if (app == null) return
    const base = t('eventSources.appSourceName', { name: app.displayName }).slice(0, 120)
    let candidate = base
    for (let suffix = 2; existingNames.includes(candidate); suffix += 1) candidate = `${base} ${suffix}`
    setName(candidate)
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (pending) return
    if (step == 1) {
      if (identified) setStep(2)
      return
    }
    if (events.length == 0 || (source == null && !identified)) return
    setPending(true)
    onPendingChange?.(true)
    setError(undefined)
    try {
      const saved =
        source == null
          ? await client.createEventSource({
              version: 1,
              name,
              connectionId,
              teamId: teamId || null,
              verificationToken: token,
              encryptKey: key,
              eventTypes: events,
              manageSubscriptions: managed,
            })
          : await client.updateEventSource(source.sourceId, {
              version: 1,
              expectedRevision: source.revision,
              name,
              enabled: source.enabled,
              eventTypes: events,
              ...(token ? { verificationToken: token } : {}),
              ...(key ? { encryptKey: key } : {}),
            })
      setToken('')
      setKey('')
      onSaved(saved)
    } catch (cause) {
      setError(errorNotice(cause, t).message)
    } finally {
      setPending(false)
      onPendingChange?.(false)
    }
  }
  return (
    <form className="flex flex-col gap-5 rounded-lg border border-border p-5" onSubmit={(event) => void save(event)} aria-busy={pending}>
      <header className="flex flex-col gap-2">
        <h2 className="m-0 text-base leading-6 font-medium">
          {t(source != null ? 'eventSources.edit' : step == 1 ? 'eventSources.selectApp' : 'eventSources.configureCallback')}
        </h2>
        {source == null && (
          <p className="m-0 text-xs text-muted-foreground">
            {step} / 2 · {t(step == 1 ? 'eventSources.selectAppHint' : 'eventSources.configureCallbackHint')}
          </p>
        )}
      </header>
      {step == 1 ? (
        <>
          {fixedTeamId === undefined && teams.length > 0 && (
            <SourceSelect
              label={t('eventSources.team')}
              value={teamId}
              options={teams.map((team) => ({ value: team.id, label: team.name }))}
              disabled={pending}
              onChange={(value) => {
                setTeamId(value)
                setConnectionId('')
              }}
            />
          )}
          <SourceSelect
            label={t('eventSources.feishuApp')}
            value={connectionId}
            options={(connections ?? []).filter((item) => item.status == 'active').map((item) => ({ value: item.connectionId, label: item.displayName }))}
            disabled={pending || connections == null}
            onChange={selectApp}
          />
          {connections != null && !connections.some((item) => item.status == 'active') && (
            <p className="m-0 text-sm leading-5 text-muted-foreground">{t('eventSources.noApplications')}</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {connectionPage == null ? (
              <Button type="button" disabled>
                {t('eventSources.connectApp')}
              </Button>
            ) : (
              <a
                className={buttonVariants({ variant: 'default', size: 'default' })}
                href={connectionPage}
                target="_blank"
                rel="noreferrer"
                onClick={() => {
                  connecting.current = true
                }}
              >
                {t('eventSources.connectApp')}
              </a>
            )}
            <Button type="button" variant="ghost" size="sm" onClick={() => setAttempt(attempt + 1)}>
              {t('eventSources.refresh')}
            </Button>
          </div>
          <p className="m-0 text-xs leading-5 text-muted-foreground">{t('eventSources.connectAppHint')}</p>
          {pageError != null && (
            <p role="alert" className="m-0 text-sm text-destructive">
              {pageError}
            </p>
          )}
          {connectionError != null && (
            <p role="alert" className="m-0 text-sm text-destructive">
              {connectionError}
            </p>
          )}
          {connection != null && !identified && (
            <p role="alert" className="m-0 text-sm text-destructive">
              {t('eventSources.identityUnavailable')}
            </p>
          )}
          {identified && (
            <p className="m-0 text-xs text-muted-foreground">
              App ID: <code>{appId}</code>
            </p>
          )}
        </>
      ) : (
        <>
          <div className="rounded-md bg-muted p-3 text-xs leading-5">
            <p className="m-0 font-medium">{connection?.displayName ?? source?.name}</p>
            <p className="m-0 break-all">App ID: {appId}</p>
          </div>
          <Label className="flex flex-col items-stretch gap-2">
            {t('eventSources.name')}
            <Input
              required
              maxLength={128}
              value={name}
              disabled={pending}
              onChange={(event) => {
                setNameEdited(true)
                setName(event.target.value)
              }}
            />
          </Label>
          <div className="grid gap-4 sm:grid-cols-2">
            <Label className="flex flex-col items-stretch gap-2">
              <span>
                Verification Token{' '}
                <span className="font-normal text-muted-foreground">{t(source == null ? 'eventSources.required' : 'eventSources.optional')}</span>
              </span>
              <Input
                type="password"
                autoComplete="new-password"
                required={source == null}
                value={token}
                onChange={(event) => setToken(event.target.value)}
                disabled={pending}
                placeholder={source == null ? undefined : t('eventSources.keepSecret')}
              />
            </Label>
            <Label className="flex flex-col items-stretch gap-2">
              <span>
                Encrypt Key <span className="font-normal text-muted-foreground">{t(source == null ? 'eventSources.required' : 'eventSources.optional')}</span>
              </span>
              <Input
                type="password"
                autoComplete="new-password"
                required={source == null}
                value={key}
                onChange={(event) => setKey(event.target.value)}
                disabled={pending}
                placeholder={source == null ? undefined : t('eventSources.keepSecret')}
              />
            </Label>
          </div>
          <p className="m-0 text-xs leading-5 text-muted-foreground">{t('eventSources.secretsHint')}</p>
          <a className="w-fit text-xs text-foreground underline underline-offset-4" href="https://open.feishu.cn/app" target="_blank" rel="noreferrer">
            {t('eventSources.openConsole')}
          </a>
          <section className="flex flex-col gap-3 border-t border-border pt-5">
            <FeishuEventPicker value={events} onChange={setEvents} disabled={pending} />
            <p className="m-0 text-xs leading-5 text-muted-foreground">{t('eventSources.eventsHint')}</p>
          </section>
          {source == null && (
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">{t('eventSources.resourceManagement')}</summary>
              <Label className="mt-3 flex items-start gap-2 font-normal">
                <Checkbox checked={managed} onCheckedChange={(value) => setManaged(value === true)} disabled={pending} />
                <span className="text-xs leading-5">{t('eventSources.manageHint')}</span>
              </Label>
            </details>
          )}
        </>
      )}
      {error != null && (
        <p role="alert" className="m-0 text-sm text-destructive">
          {error}
        </p>
      )}
      <footer className="flex justify-end gap-2 border-t border-border pt-4">
        {source == null && step == 2 && (
          <Button type="button" variant="ghost" disabled={pending} onClick={() => setStep(1)}>
            {t('eventSources.back')}
          </Button>
        )}
        <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
          {t('eventSources.cancel')}
        </Button>
        <Button type="submit" disabled={pending || (source == null && !identified) || (step == 2 && events.length == 0)}>
          {t(step == 1 ? 'eventSources.next' : 'eventSources.save')}
        </Button>
      </footer>
    </form>
  )
}

export function SourceSelect({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  readonly label: string
  readonly value: string
  readonly options: readonly { readonly value: string; readonly label: string }[]
  readonly disabled: boolean
  readonly onChange: (value: string) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      <Select
        value={value || null}
        items={options}
        disabled={disabled || options.length == 0}
        onValueChange={(next) => {
          if (typeof next == 'string') onChange(next)
        }}
      >
        <SelectTrigger className="w-full" aria-label={label}>
          <SelectValue placeholder={label} />
        </SelectTrigger>
        <SelectContent align="start" alignItemWithTrigger={false}>
          <SelectGroup>
            {options.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}
