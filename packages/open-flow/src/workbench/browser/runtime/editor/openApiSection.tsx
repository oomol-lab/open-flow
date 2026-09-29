import type { ReactNode } from 'react'
import type { JsonValue, ManagedTaskDefinition } from '../../../../flow/common/change.ts'
import type { OpenApiExecutor, OpenApiOperation } from '../../../../openapi/common/openapi.ts'

import { dequal } from 'dequal/lite'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { ValueEditorFeedback } from '../../../../form/browser/fieldControl.tsx'
import { selectionMenuContentClass, selectionMenuItemClass } from '../../../../form/browser/selectionMenuStyles.ts'
import { OpenApiDocumentSession } from '../../../../openapi/common/documentSession.ts'
import {
  listOperations,
  openApiTask,
  securityOptions,
  selectOperation,
  servers,
  serverAddress,
  object,
  openApiFieldIssues,
} from '../../../../openapi/common/openapi.ts'
import { Button } from '../../../../ui/browser/button.tsx'
import { Field, FieldLabel } from '../../../../ui/browser/field.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { NativeSelect, NativeSelectOption } from '../../../../ui/browser/native-select.tsx'
import { Popover, PopoverTrigger, PopoverContent } from '../../../../ui/browser/popover.tsx'
import { SelectChevron } from '../../../../ui/browser/select.tsx'
import { Icon } from '../icons.tsx'

export function OpenApiSection({
  task,
  disabled,
  load,
  onSave,
  credentials,
}: {
  readonly credentials?: (onInvalidChange: (invalid: boolean) => void) => ReactNode
  readonly task: ManagedTaskDefinition
  readonly disabled: boolean
  readonly load: (url: string, signal: AbortSignal) => Promise<JsonValue>
  readonly onSave: (before: ManagedTaskDefinition, value: ManagedTaskDefinition) => Promise<boolean>
}) {
  const t = useTranslate()
  const config = task.executor as OpenApiExecutor
  const [url, setUrl] = useState(config.sourceUrl)
  const [address, setAddress] = useState(config.serverUrl)
  const [document, setDocument] = useState<JsonValue>()
  const [serverError, setServerError] = useState('')
  const [operationFailure, setOperationFailure] = useState('')
  const [documentError, setDocumentError] = useState('')
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [operationsOpen, setOperationsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [serverIndex, setServerIndex] = useState<number>()
  const [serversOpen, setServersOpen] = useState(false)
  const [serverVariables, setServerVariables] = useState<Record<string, string>>({})
  const [keyName, setKeyName] = useState(config.auth.find((item) => item.id == 'manual')?.name ?? 'X-API-Key')
  const keyLocation = config.auth.find((item) => item.id == 'manual')?.in ?? 'header'
  const loadRef = useRef(load)
  loadRef.current = load
  const [session] = useState(() => new OpenApiDocumentSession((source, signal) => loadRef.current(source, signal)))
  const generation = useRef(0)
  useEffect(
    () => () => {
      generation.current++
      session.clear()
    },
    [session],
  )
  useEffect(() => {
    setAddress(config.serverUrl)
  }, [config.serverUrl])
  async function read(refresh = false): Promise<JsonValue | undefined> {
    const current = ++generation.current
    if (!url.trim()) return
    setLoading(true)
    setDocumentError('')
    try {
      const result = await session.read(url, refresh)
      if (generation.current != current) return
      setDocument(result)
      return result
    } catch (error) {
      if (generation.current == current) {
        setDocument(undefined)
        setOperationsOpen(false)
        setDocumentError((error as Error).message)
      }
    } finally {
      if (generation.current == current) setLoading(false)
    }
  }
  async function save(next: OpenApiExecutor, field: 'operation' | 'serverUrl' = 'operation') {
    const report = field == 'serverUrl' ? setServerError : setOperationFailure
    try {
      if (next.serverUrl) {
        const server = new URL(next.serverUrl)
        if (!['http:', 'https:'].includes(server.protocol) || server.username || server.password || server.search || server.hash)
          throw new Error('Enter an HTTP(S) server URL without credentials, query or fragment.')
      }
      if (await onSave(task, openApiTask(next, task.name))) {
        report('')
        setOperationsOpen(false)
      } else report(t('openapi.saveFailed'))
    } catch (error) {
      report((error as Error).message)
    }
  }
  const savedSelection = !!config.path && url == config.sourceUrl
  const issues = openApiFieldIssues({ ...task, executor: { ...config, sourceUrl: url, serverUrl: address } })
  const sourceIssue = issues.find((issue) => issue.field == 'sourceUrl')
  const showOperations = savedSelection || (!!url.trim() && !documentError && document != null)
  const urlError = loading
    ? undefined
    : documentError ||
      (sourceIssue
        ? !url.trim()
          ? t('openapi.urlRequired')
          : sourceIssue.message
        : !savedSelection && document == null
          ? t('openapi.loadRequired')
          : undefined)
  const operationError = operationFailure || (!savedSelection ? t('openapi.operationRequired') : issues.find((issue) => issue.field == 'operation')?.message)
  const addressError = serverError || issues.find((issue) => issue.field == 'serverUrl')?.message
  const operations = document == null ? [] : listOperations(document)
  const grouped = operations.some((op) => op.tag.trim() != '')
  const query = search.toLowerCase()
  const choices = operations.filter((op) => `${op.tag} ${op.label} ${op.method} ${op.path}`.toLowerCase().includes(query))
  const groups = Map.groupBy(choices, (op) => op.tag.trim())
  const untagged = groups.get('')
  if (untagged != null) {
    groups.delete('')
    groups.set('', untagged)
  }
  const availableServers = config.path
    ? (() => {
        try {
          return servers(document ?? config.document, config.path, config.method)
        } catch {
          return []
        }
      })()
    : []
  const selectedServer = serverIndex == null ? undefined : availableServers[serverIndex]
  const security = config.path ? securityOptions(config.document, config.path, config.method) : []
  const declaredAuth = security.findIndex((entry) => dequal(entry.auth, config.auth))
  const manualAuth = config.auth.find((item) => item.id == 'manual')
  function useServer(index: number, variables: Record<string, string> = {}) {
    try {
      const serverUrl = serverAddress(availableServers[index]!, url, variables)
      setServerIndex(index)
      setServerVariables(variables)
      setAddress(serverUrl)
      setServersOpen(false)
      void save({ ...config, serverUrl }, 'serverUrl')
    } catch (error) {
      setServerError((error as Error).message)
    }
  }
  function useAuth(type: 'bearer' | 'basic' | 'apiKey', name = keyName, location = keyLocation) {
    void save({ ...config, auth: [{ id: 'manual', type, ...(type == 'apiKey' ? { name, in: location } : {}) }] })
  }
  const renderOperation = (op: OpenApiOperation) => (
    <Button
      className={`w-full h-auto justify-start px-2 whitespace-normal text-left ${selectionMenuItemClass}`}
      key={`${op.method} ${op.path}`}
      variant="ghost"
      disabled={disabled}
      onClick={() => {
        try {
          void save(selectOperation(document!, url, op.path, op.method))
        } catch (error) {
          setOperationFailure((error as Error).message)
        }
      }}
    >
      <span className="shrink-0 self-start font-mono text-muted-foreground">{op.method.toUpperCase()}</span>
      <span className="min-w-0 break-words">
        <span className="font-mono text-foreground">{op.path}</span>
        <span className="pl-2 text-muted-foreground"> {op.label}</span>
      </span>
    </Button>
  )
  return (
    <>
      <Field className="inspector-field-section" data-inspector-section="task">
        <FieldLabel className="inspector-section-title">OpenAPI</FieldLabel>
        <div ref={setContainer} className="node-settings flex flex-col gap-3">
          <Field>
            <FieldLabel htmlFor="openapi-url">{t('openapi.document')}</FieldLabel>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <ValueEditorFeedback error={urlError}>
                  {(errorId) => (
                    <Input
                      aria-invalid={urlError != null}
                      aria-describedby={errorId}
                      id="openapi-url"
                      disabled={disabled}
                      value={url}
                      onChange={(event) => {
                        generation.current++
                        session.clear()
                        setDocument(undefined)
                        setOperationsOpen(false)
                        setLoading(false)
                        setDocumentError('')
                        setOperationFailure('')
                        setUrl(event.target.value)
                      }}
                    />
                  )}
                </ValueEditorFeedback>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={disabled || loading || !url.trim()}
                onClick={async () => {
                  const value = await read(true)
                  if (value != null) {
                    if (!savedSelection) return
                    try {
                      const next = selectOperation(value, url, config.path, config.method)
                      void save({
                        ...next,
                        serverUrl: config.serverUrl,
                        auth:
                          securityOptions(next.document, next.path, next.method).some((choice) => dequal(choice.auth, config.auth)) ||
                          config.auth.every((item) => item.id == 'manual')
                            ? config.auth
                            : next.auth,
                      })
                    } catch (error) {
                      setOperationFailure((error as Error).message)
                    }
                  }
                }}
              >
                {t(loading ? 'openapi.loading' : 'openapi.update')}
              </Button>
            </div>
          </Field>
          {showOperations &&
            (document != null && operations.length == 0 ? (
              <p role="status" className="m-0 px-2 py-1 text-xs text-muted-foreground">
                {t('openapi.noOperations')}
              </p>
            ) : (
              <Field>
                <FieldLabel>{t('openapi.operation')}</FieldLabel>
                <Popover
                  open={operationsOpen}
                  onOpenChange={(open) => {
                    setOperationsOpen(open)
                    if (open) {
                      setSearch('')
                      void read()
                    }
                  }}
                >
                  <ValueEditorFeedback error={operationsOpen ? undefined : operationError}>
                    {(errorId) => (
                      <PopoverTrigger
                        render={<Button variant="field" size="field" />}
                        className="w-full justify-between"
                        aria-label={savedSelection ? `${config.method.toUpperCase()} ${config.path}` : t('openapi.operation')}
                        aria-expanded={operationsOpen}
                        aria-invalid={operationError != null}
                        aria-describedby={errorId}
                        disabled={disabled}
                      >
                        <span className="min-w-0 truncate">
                          {savedSelection ? (
                            <>
                              <span className="mr-2 font-mono text-muted-foreground">{config.method.toUpperCase()}</span>
                              <span className="font-mono">{config.path}</span>
                            </>
                          ) : (
                            t('openapi.operation')
                          )}
                        </span>
                        <SelectChevron />
                      </PopoverTrigger>
                    )}
                  </ValueEditorFeedback>
                  <PopoverContent
                    container={container}
                    align="start"
                    className={`w-(--anchor-width) max-w-[calc(100vw-24px)] gap-0 ${selectionMenuContentClass}`}
                    aria-label={t('openapi.operation')}
                  >
                    <div className="p-1">
                      <Input
                        aria-label={t('openapi.search')}
                        placeholder={t('openapi.search')}
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                      />
                    </div>
                    {loading && <span role="status">{t('openapi.loading')}</span>}
                    {!loading && choices.length == 0 && (
                      <p role="status" className="m-0 px-2 py-1 text-xs text-muted-foreground">
                        {t('openapi.noMatches')}
                      </p>
                    )}
                    <div className="flex max-h-64 flex-col overflow-auto px-1 pb-1">
                      {grouped
                        ? [...groups].map(([tag, entries]) => (
                            <div key={tag} role="group" aria-label={tag || t('openapi.untagged')}>
                              <div className="px-2 py-0.5 text-xs font-normal leading-5 text-muted-foreground">{tag || t('openapi.untagged')}</div>
                              <div className="ml-2 flex flex-col">{entries.map(renderOperation)}</div>
                            </div>
                          ))
                        : choices.map(renderOperation)}
                    </div>
                  </PopoverContent>
                </Popover>
              </Field>
            ))}
          {savedSelection && (
            <>
              <Field>
                <FieldLabel htmlFor="openapi-server">{t('openapi.server')}</FieldLabel>
                <ValueEditorFeedback error={addressError}>
                  {(errorId) => (
                    <div className="flex min-w-0 items-center gap-1">
                      <Input
                        aria-invalid={addressError != null}
                        aria-describedby={errorId}
                        id="openapi-server"
                        disabled={disabled}
                        value={address}
                        onChange={(event) => {
                          setAddress(event.target.value)
                          setServerIndex(undefined)
                          setServerError('')
                        }}
                        onBlur={() => {
                          if (address != config.serverUrl) void save({ ...config, serverUrl: address }, 'serverUrl')
                        }}
                      />
                      <Popover
                        open={serversOpen}
                        onOpenChange={(open) => {
                          setServersOpen(open)
                          if (open) void read()
                        }}
                      >
                        <PopoverTrigger render={<Button variant="field" size="icon-sm" />} disabled={disabled} aria-label={t('openapi.servers')}>
                          <SelectChevron />
                        </PopoverTrigger>
                        <PopoverContent container={container} align="end" aria-label={t('openapi.servers')}>
                          {loading && <span role="status">{t('openapi.loading')}</span>}
                          {availableServers.map((server, index) => {
                            let label: string
                            try {
                              label = serverAddress(server, url)
                            } catch {
                              label = String(server.url)
                            }
                            return (
                              <Button
                                key={index}
                                variant="ghost"
                                className="justify-start whitespace-normal break-all text-left h-auto"
                                onClick={() => useServer(index)}
                              >
                                {label}
                              </Button>
                            )
                          })}
                        </PopoverContent>
                      </Popover>
                    </div>
                  )}
                </ValueEditorFeedback>
              </Field>
              {selectedServer != null &&
                Object.entries(object(selectedServer.variables ?? {})).map(([name, definition]) => (
                  <Field key={name}>
                    <FieldLabel>{name}</FieldLabel>
                    <Input
                      aria-label={name}
                      value={serverVariables[name] ?? String(object(definition).default ?? '')}
                      disabled={disabled}
                      onChange={(event) => setServerVariables({ ...serverVariables, [name]: event.target.value })}
                      onBlur={() => useServer(serverIndex!, serverVariables)}
                    />
                  </Field>
                ))}
            </>
          )}
        </div>
      </Field>
      {savedSelection && (
        <AuthenticationDisclosure key={JSON.stringify(config.auth)} title={t('openapi.auth')}>
          {(onInvalidChange) => (
            <>
              <Field>
                <NativeSelect
                  aria-label={t('openapi.auth')}
                  id="openapi-auth"
                  className="w-full"
                  disabled={disabled}
                  value={declaredAuth >= 0 ? `declared:${declaredAuth}` : (manualAuth?.type ?? 'none')}
                  onChange={(event) => {
                    const value = event.target.value
                    if (value.startsWith('declared:')) {
                      const auth = security[Number(value.slice(9))]?.auth
                      if (auth != null) void save({ ...config, auth })
                    } else if (value == 'none') void save({ ...config, auth: [] })
                    else useAuth(value as 'bearer' | 'basic' | 'apiKey')
                  }}
                >
                  {security.map((entry, index) => (
                    <NativeSelectOption key={index} value={`declared:${index}`} disabled={entry.auth == null}>
                      {entry.auth?.length == 0 ? t('openapi.none') : entry.label}
                      {entry.error ? ` (${t('openapi.unsupported')})` : ''}
                    </NativeSelectOption>
                  ))}
                  {!security.some((entry) => entry.auth?.length == 0) && <NativeSelectOption value="none">{t('openapi.none')}</NativeSelectOption>}
                  <NativeSelectOption value="bearer">Bearer</NativeSelectOption>
                  <NativeSelectOption value="basic">Basic</NativeSelectOption>
                  <NativeSelectOption value="apiKey">API Key</NativeSelectOption>
                </NativeSelect>
              </Field>
              {manualAuth?.type == 'apiKey' && (
                <>
                  <Field>
                    <FieldLabel htmlFor="openapi-key-name">{t('openapi.keyName')}</FieldLabel>
                    <Input
                      id="openapi-key-name"
                      value={keyName}
                      disabled={disabled}
                      onChange={(event) => setKeyName(event.target.value)}
                      onBlur={() => {
                        if (keyName != manualAuth.name) useAuth('apiKey')
                      }}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="openapi-key-location">{t('openapi.keyLocation')}</FieldLabel>
                    <NativeSelect
                      id="openapi-key-location"
                      className="w-full"
                      value={keyLocation}
                      disabled={disabled}
                      onChange={(event) => useAuth('apiKey', keyName, event.target.value as 'header' | 'query')}
                    >
                      <NativeSelectOption value="header">Header</NativeSelectOption>
                      <NativeSelectOption value="query">Query</NativeSelectOption>
                    </NativeSelect>
                  </Field>
                </>
              )}
              {credentials?.(onInvalidChange)}
            </>
          )}
        </AuthenticationDisclosure>
      )}
    </>
  )
}

/** Initial validation can reveal errors; subsequent checks respect manual disclosure. */
function AuthenticationDisclosure({
  title,
  children,
}: {
  readonly title: string
  readonly children: (onInvalidChange: (invalid: boolean) => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const interacted = useRef(false)
  const onInvalidChange = useCallback((invalid: boolean) => {
    if (invalid && !interacted.current) setOpen(true)
  }, [])
  return (
    <details className="inspector-disclosure" data-inspector-section="inputs" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary
        onClick={() => {
          interacted.current = true
        }}
      >
        <Icon name="chevron-down" size={14} />
        <span className="inspector-disclosure-summary">
          <strong className="inspector-section-title-text">{title}</strong>
        </span>
      </summary>
      <div className="inspector-disclosure-content node-settings flex flex-col gap-3">{children(onInvalidChange)}</div>
    </details>
  )
}
