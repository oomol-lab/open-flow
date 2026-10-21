import type { FormEvent } from 'react'
import type { ConnectorConnection, ControlClient, CreateEventSource, EventSource } from '../../../control/common/api.ts'
import type { UiLanguage } from '../../../localization/common/languages.ts'
import type { WorkbenchNotification } from './contract.ts'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { I18nProvider, useTranslate } from 'val-i18n-react'
import { Button, buttonVariants } from '../../../ui/browser/button.tsx'
import { Checkbox } from '../../../ui/browser/checkbox.tsx'
import { Input } from '../../../ui/browser/input.tsx'
import { Label } from '../../../ui/browser/label.tsx'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '../../../ui/browser/select.tsx'
import { eventSourceKind, eventSourcePresentations } from './eventSourcePresentation.ts'
import { EventSourceSetup } from './eventSourceSetup.tsx'
import { FeishuEventPicker } from './feishuEventPicker.tsx'
import { createI18n } from './i18n.ts'
import { errorNotice } from './stores/workbenchNotice.ts'

type EventSourceKind = NonNullable<CreateEventSource['kind']>

interface Props {
  /** Host notification channel for operation failures; use the same handler as WorkbenchHost.notify. */
  readonly notify: (notification: WorkbenchNotification) => void
  readonly client: Pick<
    ControlClient,
    'listEventSources' | 'createEventSource' | 'updateEventSource' | 'deleteEventSource' | 'listEventSourceConnections' | 'createConnectorConnectionPage'
  >
  readonly language: UiLanguage
  readonly onSourcesChange?: (sources: readonly EventSource[]) => void
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

function EventSources({ client, teams, onSourcesChange, notify }: Props) {
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
      if (current == sequence.current) {
        setSources(result.sources)
        onSourcesChange?.(result.sources)
      }
    } catch (cause) {
      if (current == sequence.current) setError(errorNotice(cause, t).message)
    }
  }, [client, t, onSourcesChange])
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
      notify(errorNotice(cause, t))
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
      notify(errorNotice(cause, t))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-5 text-sm text-foreground">
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
          notify={notify}
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
                {source.provider === 'jira' && source.enabled
                  ? t(`eventSources.subscription.${source.subscriptionStatus ?? 'idle'}`)
                  : t(
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
            notify={notify}
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
  )
}

export function SourceForm({
  source,
  sourceKind,
  existingNames = [],
  fixedTeamId,
  onPendingChange,
  client,
  teams,
  onSaved,
  onCancel,
  notify,
}: Omit<Props, 'language'> & {
  readonly sourceKind?: EventSourceKind
  readonly source?: EventSource
  readonly existingNames?: readonly string[]
  readonly onPendingChange?: (pending: boolean) => void
  readonly fixedTeamId?: string | null
  readonly onSaved: (source: EventSource) => void
  readonly onCancel: () => void
}) {
  const t = useTranslate()
  const [kind, setKind] = useState<EventSourceKind>(source == null ? (sourceKind ?? 'feishu') : eventSourceKind(source.provider))
  const presentation = eventSourcePresentations[kind]
  const [applicationId, setApplicationId] = useState(source != null && source.provider !== 'feishu' && source.provider !== 'feishu_app_bot' ? source.appId : '')
  const [organizationId, setOrganizationId] = useState(source?.organizationId ?? '')
  const [installationId, setInstallationId] = useState(source?.installationId ?? '')
  const [project, setProject] = useState(source?.projectKey ?? '')
  const [workspaceId, setWorkspaceId] = useState(source?.workspaceId ?? '')
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
  const [events, setEvents] = useState<string[]>(source?.eventTypes ?? [...presentation.events])
  const [managed, setManaged] = useState(source?.manageSubscriptions ?? false)
  const [pending, setPending] = useState(false)
  useEffect(() => {
    if (source != null) return
    const controller = new AbortController()
    setConnections(undefined)
    setConnectionError(undefined)
    void client.listEventSourceConnections(teamId || null, controller.signal, kind).then(
      (items) => {
        if (!controller.signal.aborted) setConnections(items)
      },
      (cause) => {
        if (!controller.signal.aborted) setConnectionError(errorNotice(cause, t).message)
      },
    )
    return () => controller.abort()
  }, [client, source, teamId, attempt, t, kind, presentation.provider])
  useEffect(() => {
    if (source != null) return
    let current = true
    setPageError(undefined)
    setConnectionPage(undefined)
    void client.createConnectorConnectionPage(presentation.provider, undefined, teamId || undefined).then(
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
  }, [client, source, teamId, attempt, t, kind, presentation.provider])
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
  const identified = source != null || (appId != null && presentation.identity.test(appId))
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
    try {
      let saved: EventSource
      if (source == null) {
        const common = { version: 1 as const, name, connectionId, teamId: teamId || null, eventTypes: events }
        let input: CreateEventSource
        switch (kind) {
          case 'jira':
            input = { ...common, kind, project }
            break
          case 'feishu':
            input = { ...common, verificationToken: token, encryptKey: key, manageSubscriptions: managed }
            break
          case 'slack':
            input = { ...common, kind, appId: applicationId, workspaceId, signingSecret: key }
            break
          case 'fireflies':
            input = { ...common, kind, signingSecret: key }
            break
          case 'zoom':
          case 'intercom':
            input = { ...common, kind, appId: applicationId, signingSecret: key }
            break
          case 'sentry':
            input = { ...common, kind, appId: applicationId, installationId, organizationId, signingSecret: key }
            break
        }
        saved = await client.createEventSource(input)
      } else {
        saved = await client.updateEventSource(source.sourceId, {
          version: 1,
          expectedRevision: source.revision,
          name,
          enabled: source.enabled,
          eventTypes: events,
          ...(kind === 'feishu' && token ? { verificationToken: token } : {}),
          ...(key ? (kind !== 'feishu' ? { signingSecret: key } : { encryptKey: key }) : {}),
        })
      }
      setToken('')
      setKey('')
      onSaved(saved)
    } catch (cause) {
      notify(errorNotice(cause, t))
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
            {step} / 2 · {t(step === 1 ? presentation.connectHint : presentation.configureHint)}
          </p>
        )}
      </header>
      {step == 1 ? (
        <>
          <SourceSelect
            label={t('eventSources.provider')}
            value={kind}
            options={Object.entries(eventSourcePresentations).map(([value, item]) => ({ value, label: item.label }))}
            disabled={pending || sourceKind != null}
            onChange={(value) => {
              const next = value as EventSourceKind
              setKind(next)
              setConnectionId('')
              setEvents([...eventSourcePresentations[next].events])
              setToken('')
              setKey('')
            }}
          />
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
            label={kind === 'feishu' ? t('eventSources.feishuApp') : presentation.label}
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
          {kind !== 'feishu' && kind !== 'fireflies' && kind !== 'jira' && source == null && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Label className="flex flex-col items-stretch gap-2">
                {kind === 'slack' ? 'Slack App ID' : kind === 'sentry' ? 'Integration UUID' : 'Developer App ID'}
                <Input
                  required
                  pattern={kind === 'slack' ? 'A[A-Z0-9]+' : undefined}
                  value={applicationId}
                  onChange={(event) => setApplicationId(event.target.value)}
                  disabled={pending}
                />
              </Label>
              {kind === 'sentry' && (
                <Label className="flex flex-col items-stretch gap-2">
                  Organization ID / slug
                  <Input required value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} disabled={pending} />
                </Label>
              )}
              {kind === 'sentry' && (
                <Label className="flex flex-col items-stretch gap-2">
                  Installation UUID
                  <Input required value={installationId} onChange={(event) => setInstallationId(event.target.value)} disabled={pending} />
                </Label>
              )}
              {kind === 'slack' && (
                <Label className="flex flex-col items-stretch gap-2">
                  Workspace ID
                  <Input required pattern="T[A-Z0-9]+" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} disabled={pending} />
                </Label>
              )}
            </div>
          )}
          {kind === 'jira' && (
            <Label className="flex flex-col items-stretch gap-2">
              {t('eventSources.jiraProject')}
              <Input required value={project} maxLength={256} disabled={pending || source != null} onChange={(event) => setProject(event.target.value)} />
            </Label>
          )}
          {kind !== 'jira' && (
            <div className="grid gap-4 sm:grid-cols-2">
              {kind === 'feishu' && (
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
              )}
              <Label className="flex flex-col items-stretch gap-2">
                <span>
                  {presentation.secret}{' '}
                  <span className="font-normal text-muted-foreground">{t(source == null ? 'eventSources.required' : 'eventSources.optional')}</span>
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
          )}
          <p className="m-0 text-xs leading-5 text-muted-foreground">{t(presentation.secretsHint)}</p>
          <a className="w-fit text-xs text-foreground underline underline-offset-4" href={presentation.console} target="_blank" rel="noreferrer">
            {t('eventSources.openConsole')}
          </a>
          <section className="flex flex-col gap-3 border-t border-border pt-5">
            {kind === 'feishu' ? (
              <FeishuEventPicker value={events} onChange={setEvents} disabled={pending} />
            ) : (
              presentation.events.map((type) => (
                <Label key={type} className="flex items-center gap-2">
                  <Checkbox
                    disabled={pending}
                    checked={events.includes(type)}
                    onCheckedChange={(checked) => setEvents(checked ? [...events, type] : events.filter((event) => event !== type))}
                  />
                  <code>{type}</code>
                </Label>
              ))
            )}
            <p className="m-0 text-xs leading-5 text-muted-foreground">{t(presentation.eventsHint)}</p>
          </section>
          {source == null && kind === 'feishu' && (
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
