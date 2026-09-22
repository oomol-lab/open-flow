import type { SetStateAction } from 'react'
import type { AgentTool, InputPort, ManagedTaskExecutor } from '../../../../flow/common/change.ts'
import type { ConnectorConnection } from '../api.ts'
import type { ConnectorActionView } from '../connectionCatalog.ts'
import type { WorkbenchTheme } from '../contract.ts'
import type { ConnectorStore } from '../stores/connectorStore.ts'

import { ChevronDown, ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { Field, FieldLabel, FieldDescription } from '../../../../ui/browser/field.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { Textarea } from '../../../../ui/browser/textarea.tsx'
import { WorkbenchSelect } from '../shell/workbenchSelect.tsx'
import { ActionPicker } from './actionPicker.tsx'
import { AgentInputSource } from './agentInputSource.tsx'
import { agentTool } from './flowChanges.ts'

export function AgentTools({
  config,
  setConfig,
  disabled,
  portalRoot,
  inputs,
  theme,
  validity,
  save,
  nodeId,
  connectors,
  prepareAction,
  setError,
}: {
  readonly config: Extract<ManagedTaskExecutor, { kind: 'agent' }>
  readonly setConfig: (value: SetStateAction<ManagedTaskExecutor>, commit?: boolean) => void
  readonly disabled: boolean
  readonly portalRoot: HTMLElement | null
  readonly inputs: readonly InputPort[]
  readonly theme: WorkbenchTheme
  readonly validity: (key: string, valid: boolean) => void
  readonly save: () => void
  readonly nodeId: string
  readonly connectors: ConnectorStore
  readonly prepareAction?: (
    action: ConnectorActionView,
  ) => Promise<{ readonly action: ConnectorActionView; readonly connections: readonly ConnectorConnection[] } | undefined>
  readonly setError: (error: string) => void
}) {
  const t = useTranslate()
  const [parameter, setParameter] = useState<string>()
  const [pendingTool, setPendingTool] = useState<{ readonly action: ConnectorActionView; readonly connections: readonly ConnectorConnection[] }>()
  const [connectionId, setConnectionId] = useState<string>()

  const actions = useVal(connectors.$.actions)
  const catalogs = useVal(connectors.$.catalogs)
  const actionIds = config.kind == 'agent' ? config.tools.map((tool) => tool.action).join(',') : ''
  const services =
    config.kind == 'agent'
      ? [...new Set(config.tools.flatMap((tool) => (actions[tool.action]?.authenticated ? [actions[tool.action]!.serviceId] : [])))].join(',')
      : ''
  useEffect(() => {
    const controller = new AbortController()
    void Promise.all([
      ...(actionIds == '' ? [] : actionIds.split(',').map((id) => connectors.loadCodeAction(id, controller.signal))),
      ...(services == '' ? [] : services.split(',').map((id) => connectors.loadCodeConnections(id, controller.signal))),
    ]).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(String(cause))
    })
    return () => controller.abort()
  }, [connectors, actionIds, services])

  const replaceTool = (tool: AgentTool, commit = true) =>
    setConfig((current) => (current.kind != 'agent' ? current : { ...current, tools: current.tools.map((item) => (item.id == tool.id ? tool : item)) }), commit)

  const addTool = (action: ConnectorActionView, accountId?: string): void => {
    setConfig((current) => (current.kind != 'agent' ? current : { ...current, tools: [...current.tools, agentTool(action, crypto.randomUUID(), accountId)] }))
    setPendingTool(undefined)
    setConnectionId(undefined)
  }

  return (
    <section className="agent-tools" aria-labelledby={`${nodeId}-tools`}>
      <h3 id={`${nodeId}-tools`}>{t('agent.tools')}</h3>
      {config.tools.length == 0 && config.code != true && <FieldDescription>{t('agent.toolsHint')}</FieldDescription>}
      {config.tools.map((tool) => (
        <details key={tool.id} className="inspector-disclosure inspector-disclosure-compact">
          <summary>
            <ChevronDown size={14} />
            <span>
              {actions[tool.action]?.serviceName ?? tool.action.split('.')[0]} · {actions[tool.action]?.name ?? tool.name}
            </span>
          </summary>
          <div className="inspector-disclosure-content">
            {actions[tool.action]?.authenticated == true && (
              <Field>
                <FieldLabel>{t('agent.connection')}</FieldLabel>
                <WorkbenchSelect
                  size="sm"
                  variant="subtle"
                  ariaLabel={t('agent.connection')}
                  value={tool.connectionId ?? ''}
                  onValueChange={(value) => {
                    const { connectionId: _connection, ...rest } = tool
                    replaceTool(value == '' ? rest : { ...rest, connectionId: value })
                  }}
                  disabled={disabled}
                  portalRoot={portalRoot}
                  className="w-full min-w-0"
                  options={[
                    { value: '', label: t('agent.chooseConnection') },
                    ...(tool.connectionId != null && !catalogs[actions[tool.action]!.serviceId]?.byId.has(tool.connectionId)
                      ? [{ value: tool.connectionId, label: tool.connectionId }]
                      : []),
                    ...(catalogs[actions[tool.action]!.serviceId]?.all ?? []).map((connection) => ({
                      value: connection.connectionId,
                      label: connection.displayName,
                      disabled: connection.status != 'active',
                    })),
                  ]}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="self-start"
                  onClick={() => void connectors.connect(actions[tool.action]!.serviceId).catch((cause: unknown) => setError(String(cause)))}
                >
                  {t('inspector.actions.connect')}
                </Button>
              </Field>
            )}
            <FieldDescription>
              {tool.inputs.some((port) => port.source.kind != 'model')
                ? t('agent.assigned', {
                    fields: tool.inputs
                      .filter((port) => port.source.kind != 'model')
                      .map((port) => port.handle)
                      .join(', '),
                  })
                : t('agent.modelParameters')}
            </FieldDescription>
            <details className="inspector-disclosure inspector-disclosure-compact">
              <summary>
                <ChevronDown size={14} />
                <span>{t('agent.parameters')}</span>
              </summary>
              <div className="inspector-disclosure-content">
                <FieldDescription>{t('agent.parametersHint')}</FieldDescription>
                {tool.inputs.map((port) => {
                  const id = `${tool.id}-${port.handle}`
                  const open = parameter == id
                  const binding = port.source
                  const summary =
                    binding.kind == 'model'
                      ? t('agent.modelValue')
                      : binding.kind == 'input'
                        ? `${t('agent.nodeInput')} · ${binding.input}`
                        : `${t('agent.fixed')} · ${binding.value === null ? t('agent.empty') : binding.value === '' ? t('agent.blank') : typeof binding.value == 'string' ? binding.value : JSON.stringify(binding.value)}`
                  return (
                    <div key={port.handle} className="agent-parameter">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start"
                        aria-expanded={open}
                        aria-controls={`${id}-editor`}
                        onClick={() => setParameter(open ? undefined : id)}
                      >
                        {open ? <ChevronDown /> : <ChevronRight />}
                        <span id={`${id}-label`} className="min-w-0 flex-1 truncate text-left">
                          {port.handle}
                        </span>
                        <span className="max-w-[60%] truncate text-muted-foreground" title={summary}>
                          {summary}
                        </span>
                      </Button>
                      {open && (
                        <Field id={`${id}-editor`} className="agent-parameter-editor">
                          <FieldDescription>{port.description}</FieldDescription>
                          <AgentInputSource
                            disabled={disabled}
                            portalRoot={portalRoot}
                            model
                            labelledBy={`${tool.id}-${port.handle}-label`}
                            port={port}
                            inputs={inputs}
                            theme={theme}
                            onValidChange={(valid) => validity(`${tool.id}:${port.handle}`, valid)}
                            source={port.source}
                            onCommit={save}
                            onChange={(source, commit) =>
                              setConfig(
                                (current) =>
                                  current.kind != 'agent'
                                    ? current
                                    : {
                                        ...current,
                                        tools: current.tools.map((item) =>
                                          item.id != tool.id
                                            ? item
                                            : { ...item, inputs: item.inputs.map((input) => (input.handle == port.handle ? { ...input, source } : input)) },
                                        ),
                                      },
                                commit,
                              )
                            }
                          />
                        </Field>
                      )}
                    </div>
                  )
                })}
              </div>
            </details>
            <details className="inspector-disclosure inspector-disclosure-compact">
              <summary>
                <ChevronDown size={14} />
                <span>{t('agent.toolDetails')}</span>
              </summary>
              <div className="inspector-disclosure-content">
                <Field>
                  <FieldLabel>{t('agent.toolName')}</FieldLabel>
                  <Input
                    data-agent-text
                    aria-label={t('agent.toolName')}
                    value={tool.name}
                    onChange={(event) => replaceTool({ ...tool, name: event.target.value }, false)}
                  />
                </Field>
                <Field>
                  <FieldLabel>{t('agent.description')}</FieldLabel>
                  <Textarea
                    data-agent-text
                    aria-label={t('agent.description')}
                    value={tool.description}
                    onChange={(event) => replaceTool({ ...tool, description: event.target.value }, false)}
                  />
                </Field>
              </div>
            </details>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfig({ ...config, tools: config.tools.filter((item) => item.id != tool.id) })}
            >
              {t('agent.removeTool')}
            </Button>
          </div>
        </details>
      ))}
      {pendingTool == null ? (
        <ActionPicker
          connectors={connectors}
          disabled={disabled}
          label={t('agent.addTool')}
          prepare={prepareAction ?? ((action) => connectors.resolveAction(action.actionId))}
          onSelect={async (action, connections) => {
            if (!action.authenticated) addTool(action)
            else {
              setPendingTool({ action, connections })
              setConnectionId(action.defaultConnection?.connectionId)
            }
            return true
          }}
        />
      ) : (
        <div className="inspector-disclosure-content">
          <h3>
            {pendingTool.action.serviceName} · {pendingTool.action.name}
          </h3>
          <Field>
            <FieldLabel htmlFor={`${nodeId}-new-connection`}>{t('agent.connection')}</FieldLabel>
            <WorkbenchSelect
              size="sm"
              variant="subtle"
              id={`${nodeId}-new-connection`}
              value={connectionId ?? ''}
              onValueChange={(value) => setConnectionId(value || undefined)}
              ariaLabel={t('agent.connection')}
              disabled={disabled}
              portalRoot={portalRoot}
              className="w-full min-w-0"
              options={[
                { value: '', label: t('agent.chooseConnection') },
                ...pendingTool.connections
                  .filter((connection) => connection.status == 'active')
                  .map((connection) => ({ value: connection.connectionId, label: connection.displayName })),
              ]}
            />
            {pendingTool.connections.every((connection) => connection.status != 'active') && (
              <FieldDescription>{t('inspector.account.connectBeforeRun', { service: pendingTool.action.serviceName })}</FieldDescription>
            )}
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={disabled}
              className="self-start"
              onClick={async () => {
                try {
                  await connectors.connect(pendingTool.action.serviceId)
                  const next = prepareAction == null ? await connectors.resolveAction(pendingTool.action.actionId) : await prepareAction(pendingTool.action)
                  if (next != null) setPendingTool((current) => (current == pendingTool ? next : current))
                } catch (cause) {
                  setError(String(cause))
                }
              }}
            >
              {t('inspector.account.manageAccount')}
            </Button>
          </Field>
          <FieldDescription>{t('agent.newParameters')}</FieldDescription>
          <div className="form-actions">
            <Button
              type="button"
              size="sm"
              disabled={disabled || !pendingTool.connections.some((connection) => connection.connectionId == connectionId && connection.status == 'active')}
              onClick={() => addTool(pendingTool.action, connectionId)}
            >
              {t('agent.addTool')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setPendingTool(undefined)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
