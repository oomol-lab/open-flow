import type { ReactElement } from 'react'
import type { ConnectorCapability } from '../../../../flow/common/change.ts'
import type { ConnectorStore } from '../stores/connectorStore.ts'
import type { WorkspaceStore } from '../stores/workspaceStore.ts'

import { Check, ChevronDown, Code2, Copy, Plus, RefreshCw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { OverlayScrollbar } from '../../../../designer/browser/components/overlayScrollbar.tsx'
import { Button } from '../../../../ui/browser/button.tsx'
import { Checkbox } from '../../../../ui/browser/checkbox.tsx'
import { Field, FieldLabel, FieldError } from '../../../../ui/browser/field.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { NativeSelect, NativeSelectOption } from '../../../../ui/browser/native-select.tsx'
import { ToggleGroup, ToggleGroupItem } from '../../../../ui/browser/toggle-group.tsx'

function property(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? `.${name}` : `[${JSON.stringify(name)}]`
}

export function CodeActions({
  capabilities,
  connectors,
  disabled,
  nodeId,
  store,
  context,
}: {
  readonly capabilities: readonly ConnectorCapability[]
  readonly connectors: ConnectorStore
  readonly disabled: boolean
  readonly nodeId: string
  readonly store: WorkspaceStore
  readonly context: string
}): ReactElement {
  const t = useTranslate()
  const actions = useVal(connectors.$.actions)
  const catalogs = useVal(connectors.$.catalogs)
  const flowId = useVal(store.$.flowId)
  const [preview, setPreview] = useState<string>()
  const [fullId, setFullId] = useState(false)
  const [copied, setCopied] = useState<string>()
  const [copyError, setCopyError] = useState<string>()
  useEffect(() => {
    if (copied == null) return
    const timer = setTimeout(() => setCopied(undefined), 2000)
    return () => clearTimeout(timer)
  }, [copied])
  const [adding, setAdding] = useState(false)
  const [expanded, setExpanded] = useState<string>()
  const searchInput = useRef<HTMLInputElement>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<readonly string[]>([])
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    if (adding) searchInput.current?.focus()
  }, [adding])

  const actionIds = capabilities.map((item) => item.action).join(',')
  const services = [
    ...new Set(
      capabilities
        .filter((item) => actions[item.action]?.authenticated == true || item.connections.length > 0)
        .map((item) => item.action.slice(0, item.action.indexOf('.'))),
    ),
  ]
    .toSorted()
    .join(',')

  useEffect(() => {
    const controller = new AbortController()
    setResults([])
    if (!adding || query.trim() == '') return () => controller.abort()
    setLoading(true)
    const timer = setTimeout(() => {
      void connectors
        .provideAddNodeOptions(query, controller.signal)
        .then((options) => {
          if (!controller.signal.aborted) setResults((options ?? []).flatMap((option) => (option.kind == 'connector' ? [option.connector.actionId] : [])))
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, 200)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [connectors, flowId, nodeId, query, adding])

  useEffect(() => {
    const controller = new AbortController()
    setError(undefined)
    void Promise.all([
      ...(services == '' ? [] : services.split(',').map((service) => connectors.loadCodeConnections(service, controller.signal))),
      ...(actionIds == '' ? [] : actionIds.split(',').map((id) => connectors.loadCodeAction(id, controller.signal))),
    ]).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => controller.abort()
  }, [connectors, flowId, nodeId, services, actionIds, refresh])

  const save = async (value: readonly ConnectorCapability[]): Promise<void> => {
    setSaving(true)
    try {
      if (await store.saveCodeActions(nodeId, value)) {
        setAdding(false)
        setQuery('')
        if (adding) addButton.current?.focus()
      }
    } finally {
      setSaving(false)
    }
  }
  const replace = (current: ConnectorCapability, next: ConnectorCapability): void => {
    void save(capabilities.map((item) => (item.action == current.action ? next : item)))
  }
  const locked = disabled || saving
  return (
    <OverlayScrollbar className="code-action-panel" defer={false} tabIndex={-1}>
      <section aria-label={t('inspector.actions.title')} aria-busy={saving || loading}>
        <div className="code-action-toolbar">
          <span className="code-action-caption">
            {t('inspector.actions.title')}
            <span className="code-action-count">{capabilities.length}</span>
          </span>
          <Button
            ref={addButton}
            type="button"
            size="xs"
            variant="ghost"
            disabled={locked}
            aria-expanded={adding}
            aria-controls={`actions-search-${nodeId}`}
            onClick={() => setAdding(!adding)}
          >
            {adding ? <X /> : <Plus />}
            {t(adding ? 'inspector.actions.cancel' : 'inspector.actions.add')}
          </Button>
        </div>
        {adding && (
          <div className="code-action-search" id={`actions-search-${nodeId}`}>
            <Input
              ref={searchInput}
              aria-label={t('inspector.actions.search')}
              placeholder={t('inspector.actions.search')}
              disabled={locked}
              value={query}
              onKeyDown={(event) => {
                if (event.key == 'Escape') {
                  event.stopPropagation()
                  setAdding(false)
                  setQuery('')
                  addButton.current?.focus()
                }
              }}
              onChange={(event) => {
                setQuery(event.target.value)
                setLoading(false)
                setError(undefined)
              }}
            />
            {query.trim() == '' && <p className="code-action-hint">{t('inspector.actions.description')}</p>}
            {loading && (
              <p className="code-action-hint" role="status">
                {t('inspector.actions.loading')}
              </p>
            )}
            {query.trim() != '' && !loading && results.length == 0 && (
              <p className="code-action-hint" role="status">
                {t('inspector.actions.empty')}
              </p>
            )}
            <div className="code-action-results">
              {results
                .filter((id) => !capabilities.some((item) => item.action == id))
                .map((id) => (
                  <Button
                    key={id}
                    type="button"
                    variant="ghost"
                    className="code-action-result"
                    disabled={locked}
                    onClick={() => {
                      const connection = actions[id]?.defaultConnection
                      void save([
                        ...capabilities,
                        {
                          kind: 'connector',
                          action: id,
                          connections:
                            connection == null
                              ? []
                              : [{ connectionId: connection.connectionId, ...(connection.alias == null ? {} : { alias: connection.alias }) }],
                          ...(connection == null ? {} : { connectionId: connection.connectionId }),
                        },
                      ])
                      setExpanded(id)
                    }}
                  >
                    <span className="code-action-name">
                      <span>{actions[id]?.name ?? id}</span>
                      <code>{id}</code>
                    </span>
                    <Plus />
                  </Button>
                ))}
            </div>
          </div>
        )}
        {capabilities.map((declaration) => {
          const service = declaration.action.slice(0, declaration.action.indexOf('.'))
          const action = actions[declaration.action]
          const catalog = catalogs[service]
          const first = declaration.connections[0]
          const current = declaration.connections.find((connection) => connection.connectionId == declaration.connectionId)
          const currentName = current == null ? undefined : (current.alias ?? catalog?.byId.get(current.connectionId)?.displayName)
          const options =
            declaration.connectionId == null && first != null
              ? `, { ${first.alias == null ? `connectionId: ${JSON.stringify(first.connectionId)}` : `connectionAlias: ${JSON.stringify(first.alias)}`} }`
              : ''
          const example = `await ${context}.actions${fullId ? `[${JSON.stringify(declaration.action)}]` : `${property(service)}${property(declaration.action.slice(service.length + 1))}`}({}${options})`
          const exampleId = `action-example-${nodeId}-${declaration.action}`
          const open = expanded == declaration.action
          const needsAccount = action?.authenticated == true && declaration.connections.length == 0
          const unavailable = catalog != null && declaration.connections.some((connection) => catalog.byId.get(connection.connectionId)?.status != 'active')
          const summary = unavailable
            ? t('inspector.actions.unavailable')
            : needsAccount
              ? t('inspector.actions.needsAccount')
              : (currentName ??
                (declaration.connections.length > 0
                  ? t('inspector.actions.accounts', { count: declaration.connections.length })
                  : action?.authenticated == false
                    ? t('inspector.actions.public')
                    : '…'))
          const panelId = `action-settings-${nodeId}-${declaration.action}`
          return (
            <div key={declaration.action} className="code-action-entry">
              <div className="code-action-row">
                <Button
                  type="button"
                  variant="ghost"
                  className="code-action-toggle"
                  disabled={locked}
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() => setExpanded(open ? undefined : declaration.action)}
                >
                  <ChevronDown className="code-action-chevron" />
                  <span className="code-action-name" title={declaration.action}>
                    <span>{action?.name ?? declaration.action}</span>
                    <code>{declaration.action}</code>
                  </span>
                  <span className={`code-action-account${needsAccount || unavailable ? ' needs-account' : ''}`} title={summary}>
                    {summary}
                  </span>
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  aria-expanded={preview == declaration.action}
                  aria-controls={exampleId}
                  onClick={() => {
                    setPreview(preview == declaration.action ? undefined : declaration.action)
                    setFullId(false)
                    setCopied(undefined)
                    setCopyError(undefined)
                  }}
                >
                  <Code2 />
                  {t('inspector.actions.example')}
                </Button>
              </div>
              {preview == declaration.action && (
                <div id={exampleId} className="code-action-example">
                  <div className="code-action-toolbar">
                    <ToggleGroup<'nested' | 'id'>
                      size="sm"
                      spacing={0}
                      variant="outline"
                      value={[fullId ? 'id' : 'nested']}
                      aria-label={t('inspector.actions.syntax')}
                      onValueChange={(value) => {
                        if (value[0] != null) setFullId(value[0] == 'id')
                        setCopied(undefined)
                        setCopyError(undefined)
                      }}
                    >
                      <ToggleGroupItem value="nested">{t('inspector.actions.nested')}</ToggleGroupItem>
                      <ToggleGroupItem value="id">{t('inspector.actions.fullId')}</ToggleGroupItem>
                    </ToggleGroup>
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      onClick={async () => {
                        setCopyError(undefined)
                        try {
                          await navigator.clipboard.writeText(example)
                          setCopied(example)
                        } catch {
                          setCopyError(example)
                        }
                      }}
                    >
                      {copied == example ? <Check /> : <Copy />}
                      <span role="status">{t(copied == example ? 'inspector.actions.copied' : 'inspector.actions.copy')}</span>
                    </Button>
                  </div>
                  <pre tabIndex={0} aria-label={t('inspector.actions.example')}>
                    <code>{example}</code>
                  </pre>
                  {copyError == example && <FieldError>{t('inspector.actions.copyError')}</FieldError>}
                </div>
              )}
              {open && (
                <div id={panelId} className="code-action-settings">
                  {(action?.authenticated == true || declaration.connections.length > 0) && (
                    <>
                      <div className="code-action-accounts">
                        <div className="code-action-toolbar">
                          <span className="code-action-caption">{t('inspector.actions.allowed')}</span>
                          <div className="code-action-tools">
                            <Button type="button" size="xs" variant="ghost" disabled={locked} onClick={() => void connectors.connect(service)}>
                              <Plus />
                              {t('inspector.actions.connect')}
                            </Button>
                            <Button
                              type="button"
                              size="icon-xs"
                              variant="ghost"
                              disabled={locked}
                              title={t('inspector.actions.refresh')}
                              aria-label={t('inspector.actions.refresh')}
                              onClick={() => setRefresh((value) => value + 1)}
                            >
                              <RefreshCw />
                            </Button>
                          </div>
                        </div>
                        <div className="code-action-connections">
                          {(catalog?.all ?? []).map((connection) => {
                            const binding = declaration.connections.find((item) => item.connectionId == connection.connectionId)
                            const alias = binding == null ? connection.alias : binding.alias
                            return (
                              <FieldLabel key={connection.connectionId} className="code-action-connection" title={connection.connectionId}>
                                <Checkbox
                                  disabled={locked || (connection.status != 'active' && binding == null)}
                                  checked={binding != null}
                                  onCheckedChange={(checked) => {
                                    const connections = checked
                                      ? [
                                          ...declaration.connections,
                                          { connectionId: connection.connectionId, ...(connection.alias == null ? {} : { alias: connection.alias }) },
                                        ]
                                      : declaration.connections.filter((item) => item.connectionId != connection.connectionId)
                                    const { connectionId, ...next } = declaration
                                    replace(declaration, {
                                      ...next,
                                      connections,
                                      ...(connectionId != null && connections.some((item) => item.connectionId == connectionId) ? { connectionId } : {}),
                                    })
                                  }}
                                />
                                <span className="code-action-name">
                                  <span>{connection.displayName}</span>
                                  {alias != null && alias != connection.displayName && <code>{alias}</code>}
                                </span>
                                {connection.status != 'active' && <span className="code-action-hint">{t('inspector.actions.unavailable')}</span>}
                              </FieldLabel>
                            )
                          })}
                          {declaration.connections
                            .filter((connection) => catalog != null && !catalog.byId.has(connection.connectionId))
                            .map((connection) => (
                              <div key={connection.connectionId} className="code-action-toolbar">
                                <span className="code-action-name" title={connection.connectionId}>
                                  <span>{connection.alias ?? connection.connectionId}</span>
                                  <span className="code-action-hint">{t('inspector.actions.unavailable')}</span>
                                </span>
                                <Button
                                  type="button"
                                  size="icon-xs"
                                  variant="ghost"
                                  disabled={locked}
                                  aria-label={`${t('inspector.actions.remove')} · ${connection.alias ?? connection.connectionId}`}
                                  onClick={() => {
                                    const { connectionId, ...next } = declaration
                                    replace(declaration, {
                                      ...next,
                                      connections: declaration.connections.filter((item) => item.connectionId != connection.connectionId),
                                      ...(connectionId == connection.connectionId || connectionId == null ? {} : { connectionId }),
                                    })
                                  }}
                                >
                                  <X />
                                </Button>
                              </div>
                            ))}
                        </div>
                      </div>
                      {declaration.connections.length > 0 && (
                        <Field className="code-action-default">
                          <FieldLabel htmlFor={`actions-default-${nodeId}-${declaration.action}`}>{t('inspector.actions.default')}</FieldLabel>
                          <NativeSelect
                            id={`actions-default-${nodeId}-${declaration.action}`}
                            value={declaration.connectionId ?? ''}
                            disabled={locked}
                            onChange={(event) => {
                              const { connectionId: _default, ...next } = declaration
                              replace(declaration, { ...next, ...(event.target.value == '' ? {} : { connectionId: event.target.value }) })
                            }}
                          >
                            <NativeSelectOption value="">{t('inspector.actions.explicit')}</NativeSelectOption>
                            {declaration.connections.map((connection) => (
                              <NativeSelectOption key={connection.connectionId} value={connection.connectionId}>
                                {connection.alias ?? catalog?.byId.get(connection.connectionId)?.displayName ?? connection.connectionId}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                          {declaration.connectionId != null && <p className="code-action-hint">{t('inspector.actions.defaultHint')}</p>}
                        </Field>
                      )}
                    </>
                  )}
                  {declaration.connections.length > 0 && (
                    <details className="code-action-details">
                      <summary>{t('inspector.actions.details')}</summary>
                      {declaration.connections.map((connection) => (
                        <div key={connection.connectionId} className="code-action-identity">
                          <span>{connection.alias ?? catalog?.byId.get(connection.connectionId)?.displayName ?? '—'}</span>
                          <code>{connection.connectionId}</code>
                        </div>
                      ))}
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        disabled={locked || catalog == null}
                        onClick={() =>
                          replace(declaration, {
                            ...declaration,
                            connections: declaration.connections.map((selected) => {
                              const connection = catalog?.byId.get(selected.connectionId)
                              return connection == null
                                ? selected
                                : { connectionId: selected.connectionId, ...(connection.alias == null ? {} : { alias: connection.alias }) }
                            }),
                          })
                        }
                      >
                        {t('inspector.actions.aliases')}
                      </Button>
                    </details>
                  )}
                  <div className="code-action-footer">
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      disabled={locked}
                      onClick={() => void save(capabilities.filter((item) => item.action != declaration.action))}
                    >
                      {t('inspector.actions.removeAction')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
        {error != null && (
          <FieldError role="alert">
            {error}
            <Button type="button" size="xs" variant="ghost" disabled={locked} onClick={() => setRefresh((value) => value + 1)}>
              {t('inspector.actions.refresh')}
            </Button>
          </FieldError>
        )}
      </section>
    </OverlayScrollbar>
  )
}
