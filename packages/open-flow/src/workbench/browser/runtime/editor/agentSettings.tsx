import type { ReactElement, SetStateAction } from 'react'
import type { AgentInput, AgentTool, InputPort, JsonValue, ManagedTaskDefinition, ManagedTaskExecutor } from '../../../../flow/common/change.ts'
import type { ConnectorAction } from '../api.ts'
import type { WorkbenchTheme } from '../contract.ts'
import type { ConnectorStore } from '../stores/connectorStore.ts'
import type { WorkspaceStore } from '../stores/workspaceStore.ts'

import { dequal } from 'dequal/lite'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useLang, useTranslate } from 'val-i18n-react'
import { decodeRevisionContent } from '../../../../flow/common/changeSchema.ts'
import { getDefaultValue, typeOfSchema } from '../../../../form/common/schemaWidget.ts'
import { Button } from '../../../../ui/browser/button.tsx'
import { Field, FieldLabel, FieldError, FieldDescription } from '../../../../ui/browser/field.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { Switch } from '../../../../ui/browser/switch.tsx'
import { Textarea } from '../../../../ui/browser/textarea.tsx'
import { WorkbenchSelect } from '../shell/workbenchSelect.tsx'
import { ActionPicker } from './actionPicker.tsx'
import { AgentChanges, agentFixedValuesValid } from './agentChanges.ts'
import { agentTool } from './flowChanges.ts'
const InputValues = lazy(async () => {
  const module = await import('./inputValues.tsx')
  return { default: module.InputValues }
})

function Source({
  disabled,
  portalRoot,
  source,
  port,
  inputs,
  model,
  theme,
  onChange,
  onValidChange,
  onCommit,
  labelledBy,
}: {
  readonly disabled: boolean
  readonly portalRoot: HTMLElement | null
  readonly labelledBy?: string
  readonly source: AgentInput
  readonly port: InputPort
  readonly inputs: readonly InputPort[]
  readonly model: boolean
  readonly theme: WorkbenchTheme
  readonly onChange: (source: AgentInput, commit?: boolean) => void
  readonly onValidChange: (valid: boolean) => void
  readonly onCommit: () => void
}): ReactElement {
  const t = useTranslate()
  const language = useLang()
  const callbacks = useRef({ onChange, onValidChange, onCommit })
  callbacks.current = { onChange, onValidChange, onCommit }
  const change = useCallback(
    (values: Readonly<Record<string, JsonValue>>) => {
      const value = values[port.handle]
      if (value !== undefined) callbacks.current.onChange({ kind: 'value', value }, false)
    },
    [port.handle],
  )
  const valid = useCallback((value: boolean) => callbacks.current.onValidChange(value), [])
  const commit = useCallback(
    (values: Readonly<Record<string, JsonValue>>, isValid: boolean) => {
      callbacks.current.onValidChange(isValid)
      if (!isValid) return
      const value = values[port.handle]
      if (value !== undefined) callbacks.current.onChange({ kind: 'value', value }, false)
      callbacks.current.onCommit()
    },
    [port.handle],
  )
  useEffect(() => {
    if (source.kind != 'value') valid(true)
    return () => valid(true)
  }, [source.kind, valid])
  return (
    <>
      <WorkbenchSelect
        size="sm"
        variant="subtle"
        ariaLabel={t('agent.source')}
        value={source.kind}
        onValueChange={(value) => {
          switch (value) {
            case 'value':
              onChange({ kind: 'value', value: (port.value ?? getDefaultValue(typeOfSchema(port.jsonSchema), port.jsonSchema) ?? null) as JsonValue }, false)
              break
            case 'input':
              onChange({ kind: 'input', input: inputs[0]?.handle ?? '' })
              break
            case 'model':
              onChange({ kind: 'model' })
              break
          }
        }}
        disabled={disabled}
        portalRoot={portalRoot}
        className="w-full min-w-0"
        options={[
          { value: 'value', label: t('agent.fixed') },
          { value: 'input', label: t('agent.nodeInput'), disabled: inputs.length == 0 },
          ...(model ? [{ value: 'model', label: t('agent.modelValue') }] : []),
        ]}
      />
      {source.kind == 'input' && (
        <WorkbenchSelect
          size="sm"
          variant="subtle"
          ariaLabel={t('agent.inputName')}
          value={source.input}
          onValueChange={(value) => onChange({ kind: 'input', input: value })}
          disabled={disabled}
          portalRoot={portalRoot}
          className="w-full min-w-0"
          options={[
            ...(!inputs.some((input) => input.handle == source.input) ? [{ value: source.input, label: source.input || t('agent.chooseInput') }] : []),
            ...inputs.map((input) => ({ value: input.handle, label: input.handle })),
          ]}
        />
      )}
      {source.kind == 'value' && source.value === null && getDefaultValue(typeOfSchema(port.jsonSchema), port.jsonSchema) != null ? (
        <div className="agent-empty-value">
          <FieldDescription>{t('agent.emptyValue')}</FieldDescription>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => onChange({ kind: 'value', value: getDefaultValue(typeOfSchema(port.jsonSchema), port.jsonSchema) as JsonValue })}
          >
            {t('agent.enterValue')}
          </Button>
        </div>
      ) : (
        source.kind == 'value' && (
          <Suspense fallback={<FieldDescription>{t('inspector.wait.inputsLoading')}</FieldDescription>}>
            <InputValues
              labelledBy={labelledBy}
              definitions={[port]}
              language={language}
              theme={theme}
              values={{ [port.handle]: source.value }}
              onChange={change}
              onCommit={commit}
              onValidChange={valid}
              showErrors
            />
          </Suspense>
        )
      )}
    </>
  )
}

export function AgentSettings({
  task,
  nodeId,
  store,
  connectors,
  disabled,
  theme,
}: {
  readonly task: ManagedTaskDefinition
  readonly nodeId: string
  readonly store: WorkspaceStore
  readonly connectors: ConnectorStore
  readonly disabled: boolean
  readonly theme: WorkbenchTheme
}): ReactElement | null {
  const t = useTranslate()
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null)
  const [config, renderConfig] = useState(task.executor)
  const [parameter, setParameter] = useState<string>()
  const [pendingTool, setPendingTool] = useState<ConnectorAction>()
  const [approval, setApproval] = useState(false)
  const [saveError, setSaveError] = useState<string>()
  const [flowId] = useState(store.$.flowId.value)
  const [changes] = useState(
    () =>
      new AgentChanges(task.executor, async (before, value) => {
        if (store.$.flowId.value != flowId) return false
        const current = store.$.revision.value?.node({ kind: 'flow' }, nodeId)
        const definition = current?.kind == 'task' ? current.definition : undefined
        if (definition == null || !('executor' in definition) || !dequal(definition.executor, before)) return false
        const decoded = decodeRevisionContent({
          modelVersion: 1,
          modules: {},
          document: { bindings: {}, subflows: {}, graph: { nodes: {}, edges: [] }, tasks: { agent: { ...definition, executor: value } } },
        }).document.tasks.agent!
        return store.saveTaskSettings(nodeId, { kind: 'agent', name: definition.name, before: definition, task: decoded })
      }),
  )
  useEffect(() => {
    changes.sync(task.executor)
    renderConfig(changes.value)
  }, [changes, task.executor])
  const invalidDrafts = useRef(new Set<string>())
  const save = () => {
    const value = changes.value
    const notification = value.kind === 'agent' && value.notification != null ? store.$.revision.value?.task(value.notification.taskId) : undefined
    const notificationInputs = notification?.inputs.filter((port): port is InputPort => 'handle' in port) ?? []
    if (invalidDrafts.current.size > 0 || !agentFixedValuesValid(value, notificationInputs)) {
      setSaveError(t('agent.invalidValues'))
      return
    }
    setSaveError(undefined)
    void changes
      .save()
      .then((saved) => {
        if (!saved) setSaveError(t('agent.saveFailed'))
      })
      .catch((cause: unknown) => setSaveError(cause instanceof Error ? cause.message : String(cause)))
  }
  const setConfig = (value: SetStateAction<ManagedTaskExecutor>, commit = true) => {
    changes.value = typeof value == 'function' ? value(changes.value) : value
    renderConfig(changes.value)
    if (commit) save()
  }
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set())
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
  const [error, setError] = useState<string>()
  const revision = useVal(store.$.revision)
  if (config.kind != 'agent' || revision == null) return null
  const notifications = revision.tasks().filter(([, item]) => 'executor' in item && item.executor.kind == 'connector')
  const notificationTask = config.notification == null ? undefined : revision.task(config.notification.taskId)
  const replaceTool = (tool: AgentTool, commit = true) =>
    setConfig((current) => (current.kind != 'agent' ? current : { ...current, tools: current.tools.map((item) => (item.id == tool.id ? tool : item)) }), commit)
  const inputs = task.inputs.filter((port): port is InputPort => 'handle' in port)
  const validity = (key: string, valid: boolean) => {
    if (valid) invalidDrafts.current.delete(key)
    else invalidDrafts.current.add(key)
    setInvalid(new Set(invalidDrafts.current))
  }
  const addTool = (action: ConnectorAction, confirm: boolean): void => {
    setConfig({ ...config, tools: [...config.tools, agentTool(action, confirm, crypto.randomUUID())] })
    setPendingTool(undefined)
    setApproval(false)
  }
  return (
    <form
      ref={setPortalRoot}
      className="inspector-section inspector-form agent-form"
      data-inspector-section="task"
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
      onBlur={(event) => {
        if ((event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) && event.target.dataset.agentText != null) save()
      }}
    >
      <fieldset disabled={disabled} className="grid gap-4 border-0 p-0">
        <Field>
          <FieldLabel htmlFor={`${nodeId}-prompt`}>{t('agent.prompt')}</FieldLabel>
          <div className="agent-prompt-source">
            <WorkbenchSelect
              size="sm"
              variant="subtle"
              ariaLabel={t('agent.source')}
              value={config.prompt.kind}
              onValueChange={(value) =>
                setConfig({
                  ...config,
                  prompt: value == 'input' ? { kind: 'input', input: inputs[0]?.handle ?? '' } : { kind: 'value', value: '' },
                })
              }
              disabled={disabled}
              portalRoot={portalRoot}
              className="w-full min-w-0"
              options={[
                { value: 'value', label: t('agent.writePrompt') },
                { value: 'input', label: t('agent.nodeInput'), disabled: inputs.length == 0 },
              ]}
            />
            {config.prompt.kind == 'input' && (
              <WorkbenchSelect
                size="sm"
                variant="subtle"
                id={`${nodeId}-prompt`}
                value={config.prompt.input}
                onValueChange={(value) => setConfig({ ...config, prompt: { kind: 'input', input: value } })}
                ariaLabel={t('agent.prompt')}
                disabled={disabled}
                portalRoot={portalRoot}
                className="w-full min-w-0"
                options={[
                  ...(!inputs.some((port) => config.prompt.kind == 'input' && port.handle == config.prompt.input)
                    ? [{ value: config.prompt.input, label: config.prompt.input || t('agent.chooseInput') }]
                    : []),
                  ...inputs.map((port) => ({ value: port.handle, label: port.handle })),
                ]}
              />
            )}
          </div>
          {config.prompt.kind == 'value' && (
            <Textarea
              data-agent-text
              id={`${nodeId}-prompt`}
              rows={5}
              placeholder={t('agent.promptExample')}
              value={String(config.prompt.value)}
              onChange={(event) => setConfig({ ...config, prompt: { kind: 'value', value: event.target.value } }, false)}
            />
          )}
        </Field>
        <Field>
          <FieldLabel htmlFor={`${nodeId}-model`}>{t('agent.model')}</FieldLabel>
          <Input data-agent-text id={`${nodeId}-model`} value={config.model} onChange={(event) => setConfig({ ...config, model: event.target.value }, false)} />
        </Field>
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
                <Field>
                  <FieldLabel htmlFor={`${tool.id}-approval`}>{t('agent.execution')}</FieldLabel>
                  <WorkbenchSelect
                    size="sm"
                    variant="subtle"
                    id={`${tool.id}-approval`}
                    value={tool.approval ? 'confirm' : 'auto'}
                    onValueChange={(value) => replaceTool({ ...tool, approval: value == 'confirm' })}
                    ariaLabel={t('agent.execution')}
                    disabled={disabled}
                    portalRoot={portalRoot}
                    className="w-full min-w-0"
                    options={[
                      { value: 'auto', label: t('agent.auto') },
                      { value: 'confirm', label: t('agent.confirm') },
                    ]}
                  />
                </Field>
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
                              <Source
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
              onSelect={async (action) => {
                setPendingTool(action)
                setApproval(false)
                return true
              }}
            />
          ) : (
            <div className="inspector-disclosure-content">
              <h3>
                {pendingTool.serviceName} · {pendingTool.name}
              </h3>
              <Field>
                <FieldLabel htmlFor={`${nodeId}-new-approval`}>{t('agent.execution')}</FieldLabel>
                <WorkbenchSelect
                  size="sm"
                  variant="subtle"
                  id={`${nodeId}-new-approval`}
                  value={approval ? 'confirm' : 'auto'}
                  onValueChange={(value) => setApproval(value == 'confirm')}
                  ariaLabel={t('agent.execution')}
                  disabled={disabled}
                  portalRoot={portalRoot}
                  className="w-full min-w-0"
                  options={[
                    { value: 'auto', label: t('agent.auto') },
                    { value: 'confirm', label: t('agent.confirm') },
                  ]}
                />
                <FieldDescription>{t('agent.executionHint')}</FieldDescription>
              </Field>
              <FieldDescription>{t('agent.newParameters')}</FieldDescription>
              <div className="form-actions">
                <Button type="button" size="sm" onClick={() => addTool(pendingTool, approval)}>
                  {t('agent.addTool')}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setPendingTool(undefined)}>
                  {t('common.cancel')}
                </Button>
              </div>
            </div>
          )}
        </section>
        <details className="inspector-disclosure inspector-disclosure-compact">
          <summary>
            <ChevronDown size={14} />
            <span>{t('agent.more')}</span>
          </summary>
          <div className="inspector-disclosure-content">
            <Field orientation="horizontal">
              <div className="agent-code-copy">
                <FieldLabel htmlFor={`${nodeId}-code`}>{t('agent.code')}</FieldLabel>
                <FieldDescription id={`${nodeId}-code-description`}>{t('agent.codeHint')}</FieldDescription>
              </div>
              <Switch
                id={`${nodeId}-code`}
                aria-describedby={`${nodeId}-code-description`}
                size="sm"
                checked={config.code == true}
                onCheckedChange={(code) => setConfig({ ...config, code })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${nodeId}-system`}>{t('agent.system')}</FieldLabel>
              <Textarea
                data-agent-text
                id={`${nodeId}-system`}
                rows={4}
                value={config.system}
                onChange={(event) => setConfig({ ...config, system: event.target.value }, false)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${nodeId}-rounds`}>{t('agent.rounds')}</FieldLabel>
              <Input
                data-agent-text
                id={`${nodeId}-rounds`}
                type="number"
                min={1}
                max={100}
                value={config.maxRounds}
                onChange={(event) => setConfig({ ...config, maxRounds: Number(event.target.value) }, false)}
              />
            </Field>
            <Field>
              <FieldLabel>{t('agent.notification')}</FieldLabel>
              <WorkbenchSelect
                size="sm"
                variant="subtle"
                ariaLabel={t('agent.notification')}
                value={config.notification?.taskId ?? ''}
                onValueChange={(value) => {
                  const { notification: _notification, ...rest } = config
                  const selected = revision.task(value)
                  const message = selected?.inputs.find(
                    (port) =>
                      'handle' in port &&
                      typeof port.jsonSchema == 'object' &&
                      port.jsonSchema != null &&
                      'type' in port.jsonSchema &&
                      port.jsonSchema.type == 'string',
                  )
                  if (value == '') setConfig(rest)
                  else
                    setConfig({
                      ...rest,
                      notification: { taskId: value, messageHandle: message != null && 'handle' in message ? message.handle : '', inputs: {} },
                    })
                }}
                disabled={disabled}
                portalRoot={portalRoot}
                className="w-full min-w-0"
                options={[{ value: '', label: t('agent.noNotification') }, ...notifications.map(([id, item]) => ({ value: id, label: item.name }))]}
              />
              <FieldDescription>{t('agent.notificationHint')}</FieldDescription>
            </Field>
            {config.notification != null && notificationTask != null && (
              <>
                <Field>
                  <FieldLabel>{t('agent.messageField')}</FieldLabel>
                  <WorkbenchSelect
                    size="sm"
                    variant="subtle"
                    ariaLabel={t('agent.messageField')}
                    value={config.notification.messageHandle}
                    onValueChange={(value) => {
                      if (config.notification == null) return
                      setConfig({ ...config, notification: { ...config.notification, messageHandle: value } })
                    }}
                    disabled={disabled}
                    portalRoot={portalRoot}
                    className="w-full min-w-0"
                    options={[
                      { value: '', label: t('agent.chooseInput') },
                      ...notificationTask.inputs.flatMap((port) =>
                        'handle' in port &&
                        typeof port.jsonSchema == 'object' &&
                        port.jsonSchema != null &&
                        'type' in port.jsonSchema &&
                        port.jsonSchema.type == 'string'
                          ? [{ value: port.handle, label: port.handle }]
                          : [],
                      ),
                    ]}
                  />
                </Field>
                {notificationTask.inputs.flatMap((port) =>
                  !('handle' in port) || port.handle == config.notification?.messageHandle
                    ? []
                    : [
                        <Field key={port.handle}>
                          <FieldLabel id={`notice-${port.handle}-label`}>{port.handle}</FieldLabel>
                          <Source
                            disabled={disabled}
                            portalRoot={portalRoot}
                            labelledBy={`notice-${port.handle}-label`}
                            model={false}
                            port={port}
                            inputs={inputs}
                            theme={theme}
                            onValidChange={(valid) => validity(`notice:${port.handle}`, valid)}
                            source={config.notification?.inputs[port.handle] ?? { kind: 'value', value: port.value ?? null }}
                            onCommit={save}
                            onChange={(source, commit) => {
                              if (source.kind == 'model') return
                              setConfig(
                                (current) =>
                                  current.kind != 'agent' || current.notification == null
                                    ? current
                                    : {
                                        ...current,
                                        notification: { ...current.notification, inputs: { ...current.notification.inputs, [port.handle]: source } },
                                      },
                                commit,
                              )
                            }}
                          />
                        </Field>,
                      ],
                )}
              </>
            )}
          </div>
        </details>
        {invalid.size > 0 && saveError !== t('agent.invalidValues') && <FieldError>{t('agent.invalidValues')}</FieldError>}
        {error != null && <FieldError>{error}</FieldError>}
        {saveError != null && (
          <FieldError>
            {saveError}
            <Button type="submit" variant="outline" size="sm">
              {t('inspector.task.retrySave')}
            </Button>
          </FieldError>
        )}
      </fieldset>
    </form>
  )
}
