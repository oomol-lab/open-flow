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
import { getDefaultValue, typeOfSchema } from '../../../../designer/browser/jsonSchema/preset.ts'
import { decodeRevisionContent } from '../../../../flow/common/changeSchema.ts'
import { Button } from '../../../../ui/browser/button.tsx'
import { Field, FieldLabel, FieldError, FieldDescription } from '../../../../ui/browser/field.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { NativeSelect, NativeSelectOption } from '../../../../ui/browser/native-select.tsx'
import { Switch } from '../../../../ui/browser/switch.tsx'
import { Textarea } from '../../../../ui/browser/textarea.tsx'
import { ActionPicker } from './actionPicker.tsx'
import { AgentChanges } from './agentChanges.ts'
import { agentTool } from './flowChanges.ts'
const InputValues = lazy(async () => {
  const module = await import('./inputValues.tsx')
  return { default: module.InputValues }
})

function Source({
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
      <NativeSelect
        aria-label={t('agent.source')}
        value={source.kind}
        onChange={(event) => {
          switch (event.target.value) {
            case 'value':
              onChange({ kind: 'value', value: (port.value ?? getDefaultValue(typeOfSchema(port.jsonSchema), port.jsonSchema) ?? null) as JsonValue })
              break
            case 'input':
              onChange({ kind: 'input', input: inputs[0]?.handle ?? '' })
              break
            case 'model':
              onChange({ kind: 'model' })
              break
          }
        }}
      >
        <NativeSelectOption value="value">{t('agent.fixed')}</NativeSelectOption>
        <NativeSelectOption value="input" disabled={inputs.length == 0}>
          {t('agent.nodeInput')}
        </NativeSelectOption>
        {model && <NativeSelectOption value="model">{t('agent.modelValue')}</NativeSelectOption>}
      </NativeSelect>
      {source.kind == 'input' && (
        <NativeSelect aria-label={t('agent.inputName')} value={source.input} onChange={(event) => onChange({ kind: 'input', input: event.target.value })}>
          {!inputs.some((input) => input.handle == source.input) && (
            <NativeSelectOption value={source.input}>{source.input || t('agent.chooseInput')}</NativeSelectOption>
          )}
          {inputs.map((input) => (
            <NativeSelectOption key={input.handle} value={input.handle}>
              {input.handle}
            </NativeSelectOption>
          ))}
        </NativeSelect>
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
  const [config, renderConfig] = useState(task.executor)
  const [parameter, setParameter] = useState<string>()
  const [pendingTool, setPendingTool] = useState<ConnectorAction>()
  const [approval, setApproval] = useState<boolean>()
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
  const save = () => {
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
  const validity = (key: string, valid: boolean) =>
    setInvalid((current) => {
      if (current.has(key) == !valid) return current
      const next = new Set(current)
      if (valid) next.delete(key)
      else next.add(key)
      return next
    })
  const addTool = (action: ConnectorAction, confirm: boolean): void => {
    setConfig({ ...config, tools: [...config.tools, agentTool(action, confirm, crypto.randomUUID())] })
    setPendingTool(undefined)
    setApproval(undefined)
  }
  return (
    <form
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
            <NativeSelect
              aria-label={t('agent.source')}
              value={config.prompt.kind}
              onChange={(event) =>
                setConfig({
                  ...config,
                  prompt: event.target.value == 'input' ? { kind: 'input', input: inputs[0]?.handle ?? '' } : { kind: 'value', value: '' },
                })
              }
            >
              <NativeSelectOption value="value">{t('agent.writePrompt')}</NativeSelectOption>
              <NativeSelectOption value="input" disabled={inputs.length == 0}>
                {t('agent.nodeInput')}
              </NativeSelectOption>
            </NativeSelect>
            {config.prompt.kind == 'input' && (
              <NativeSelect
                id={`${nodeId}-prompt`}
                value={config.prompt.input}
                onChange={(event) => setConfig({ ...config, prompt: { kind: 'input', input: event.target.value } })}
              >
                {!inputs.some((port) => config.prompt.kind == 'input' && port.handle == config.prompt.input) && (
                  <NativeSelectOption value={config.prompt.input}>{config.prompt.input || t('agent.chooseInput')}</NativeSelectOption>
                )}
                {inputs.map((port) => (
                  <NativeSelectOption key={port.handle} value={port.handle}>
                    {port.handle}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
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
                    <NativeSelect
                      aria-label={t('agent.connection')}
                      value={tool.connectionId ?? ''}
                      onChange={(event) => {
                        const { connectionId: _connection, ...rest } = tool
                        replaceTool(event.target.value == '' ? rest : { ...rest, connectionId: event.target.value })
                      }}
                    >
                      <NativeSelectOption value="">{t('agent.chooseConnection')}</NativeSelectOption>
                      {tool.connectionId != null && !catalogs[actions[tool.action]!.serviceId]?.byId.has(tool.connectionId) && (
                        <NativeSelectOption value={tool.connectionId}>{tool.connectionId}</NativeSelectOption>
                      )}
                      {(catalogs[actions[tool.action]!.serviceId]?.all ?? []).map((connection) => (
                        <NativeSelectOption key={connection.connectionId} value={connection.connectionId} disabled={connection.status != 'active'}>
                          {connection.displayName}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
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
                  <NativeSelect
                    id={`${tool.id}-approval`}
                    value={tool.approval ? 'confirm' : 'auto'}
                    onChange={(event) => replaceTool({ ...tool, approval: event.target.value == 'confirm' })}
                  >
                    <NativeSelectOption value="auto">{t('agent.auto')}</NativeSelectOption>
                    <NativeSelectOption value="confirm">{t('agent.confirm')}</NativeSelectOption>
                  </NativeSelect>
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
                setApproval(undefined)
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
                <NativeSelect
                  id={`${nodeId}-new-approval`}
                  value={approval == null ? '' : approval ? 'confirm' : 'auto'}
                  onChange={(event) => setApproval(event.target.value == '' ? undefined : event.target.value == 'confirm')}
                >
                  <NativeSelectOption value="" disabled>
                    {t('agent.chooseExecution')}
                  </NativeSelectOption>
                  <NativeSelectOption value="auto">{t('agent.auto')}</NativeSelectOption>
                  <NativeSelectOption value="confirm">{t('agent.confirm')}</NativeSelectOption>
                </NativeSelect>
                <FieldDescription>{t('agent.executionHint')}</FieldDescription>
              </Field>
              <FieldDescription>{t('agent.newParameters')}</FieldDescription>
              <div className="form-actions">
                <Button
                  type="button"
                  size="sm"
                  disabled={approval == null}
                  onClick={() => {
                    if (approval != null) addTool(pendingTool, approval)
                  }}
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
              <NativeSelect
                aria-label={t('agent.notification')}
                value={config.notification?.taskId ?? ''}
                onChange={(event) => {
                  const { notification: _notification, ...rest } = config
                  const selected = revision.task(event.target.value)
                  const message = selected?.inputs.find(
                    (port) =>
                      'handle' in port &&
                      typeof port.jsonSchema == 'object' &&
                      port.jsonSchema != null &&
                      'type' in port.jsonSchema &&
                      port.jsonSchema.type == 'string',
                  )
                  if (event.target.value == '') setConfig(rest)
                  else
                    setConfig({
                      ...rest,
                      notification: { taskId: event.target.value, messageHandle: message != null && 'handle' in message ? message.handle : '', inputs: {} },
                    })
                }}
              >
                <NativeSelectOption value="">{t('agent.noNotification')}</NativeSelectOption>
                {notifications.map(([id, item]) => (
                  <NativeSelectOption key={id} value={id}>
                    {item.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <FieldDescription>{t('agent.notificationHint')}</FieldDescription>
            </Field>
            {config.notification != null && notificationTask != null && (
              <>
                <Field>
                  <FieldLabel>{t('agent.messageField')}</FieldLabel>
                  <NativeSelect
                    aria-label={t('agent.messageField')}
                    value={config.notification.messageHandle}
                    onChange={(event) => {
                      if (config.notification == null) return
                      setConfig({ ...config, notification: { ...config.notification, messageHandle: event.target.value } })
                    }}
                  >
                    <NativeSelectOption value="">{t('agent.chooseInput')}</NativeSelectOption>
                    {notificationTask.inputs.flatMap((port) =>
                      'handle' in port &&
                      typeof port.jsonSchema == 'object' &&
                      port.jsonSchema != null &&
                      'type' in port.jsonSchema &&
                      port.jsonSchema.type == 'string'
                        ? [
                            <NativeSelectOption key={port.handle} value={port.handle}>
                              {port.handle}
                            </NativeSelectOption>,
                          ]
                        : [],
                    )}
                  </NativeSelect>
                </Field>
                {notificationTask.inputs.flatMap((port) =>
                  !('handle' in port) || port.handle == config.notification?.messageHandle
                    ? []
                    : [
                        <Field key={port.handle}>
                          <FieldLabel id={`notice-${port.handle}-label`}>{port.handle}</FieldLabel>
                          <Source
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
        {invalid.size > 0 && <FieldError>{t('agent.invalidValues')}</FieldError>}
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
