import type { ReactElement } from 'react'
import type { TFunction } from 'val-i18n'
import type { GraphTarget } from '../../../../flow/common/change.ts'
import type { ConnectorAction, ConnectorConnection, Group, InputPort } from '../api.ts'
import type { WorkbenchTheme } from '../contract.ts'
import type { IconName } from '../icons.tsx'
import type { ResolvedNode, ResolvedSelection, RevisionView } from '../revisionView.ts'
import type { ConnectorStore } from '../stores/connectorStore.ts'
import type { TriggerStore } from '../stores/triggerStore.ts'
import type { WorkspaceStore } from '../stores/workspaceStore.ts'
import type { DiagnosticFocus } from './diagnostics.ts'
import type { SubflowSettings } from './flowChanges.ts'
import type { NodeInputField } from './nodeInputs.tsx'
import type { InputVariables, NodeInputUpstreamSources } from './nodeInputValue.tsx'

import { useEffect, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { nodeInputMappings } from '../../../../flow/common/condition.ts'
import { fieldSelectTriggerClass } from '../../../../form/browser/fieldSelect.tsx'
import { selectionMenuContentClass, selectionMenuItemClass } from '../../../../form/browser/selectionMenuStyles.ts'
import { Button } from '../../../../ui/browser/button.tsx'
import { Field, FieldError, FieldGroup, FieldLabel } from '../../../../ui/browser/field.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { NativeSelect, NativeSelectOption } from '../../../../ui/browser/native-select.tsx'
import { NativeScrollArea } from '../../../../ui/browser/scroll-area.tsx'
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '../../../../ui/browser/select.tsx'
import { Textarea } from '../../../../ui/browser/textarea.tsx'
import { contextName } from '../../typeScriptShadow.ts'
import { Icon } from '../icons.tsx'
import { AgentSettings } from './agentSettings.tsx'
import { presentBuiltInOutputDescription, presentBuiltInSourceCandidates, presentResolutionOutputs } from './builtInOutputPresentation.ts'
import { CodeActions } from './codeActions.tsx'
import { CodeEditor } from './codeEditor.tsx'
import { ConditionBranchesEditor } from './conditionBranchesEditor.tsx'
import { FeishuTriggerConfig } from './feishuTriggerConfig.tsx'
import { codeTyping } from './flowChanges.ts'
import { LinearTriggerConfig } from './linearTriggerConfig.tsx'
import { NodeDescription } from './nodeDescription.tsx'
import { NodeInputs } from './nodeInputs.tsx'
import { PortDefinitionEditor } from './portDefinitionEditor.tsx'
import { TriggerConfigEditor } from './triggerConfigEditor.tsx'
import { TriggerScheduleEditor } from './triggerScheduleEditor.tsx'
import { TriggerSummary } from './triggerSummary.tsx'
import { WebhookEditor } from './webhookEditor.tsx'

const manageAccountOption = '__manage-account__'

function AccountSelect({
  connections,
  disabled,
  id,
  selectedConnection,
  selectedId,
  onChange,
  onManage,
}: {
  readonly connections: readonly ConnectorConnection[]
  readonly disabled: boolean
  readonly id: string
  readonly selectedConnection?: ConnectorConnection
  readonly selectedId?: string
  readonly onChange: (connectionId: string) => void
  readonly onManage: () => void
}): ReactElement {
  const t = useTranslate()
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const selected = selectedConnection ?? connections.find((candidate) => candidate.connectionId == selectedId)
  const selectedLabel =
    selected == null
      ? selectedId == null
        ? undefined
        : `${selectedId} (${t('inspector.account.unavailable')})`
      : `${selected.displayName}${selected.isDefault ? ` (${t('inspector.account.teamDefault')})` : ''}`
  const missingSelected = selectedId != null && !connections.some((candidate) => candidate.connectionId == selectedId)
  const items = [
    ...(missingSelected ? [{ value: selectedId, label: selectedLabel!, disabled: true }] : []),
    ...connections.map((candidate) => ({
      value: candidate.connectionId,
      label: `${candidate.displayName}${candidate.isDefault ? ` (${t('inspector.account.teamDefault')})` : ''}`,
    })),
    { value: manageAccountOption, label: t('inspector.account.addAccount') },
  ]
  return (
    <div ref={setContainer} className="min-w-0">
      <Select
        disabled={disabled}
        items={items}
        value={selectedId ?? null}
        onValueChange={(value) => {
          if (value == null) return
          if (value == manageAccountOption) onManage()
          else onChange(value)
        }}
      >
        <SelectTrigger id={id} size="field" aria-label={t('inspector.account.connection')} className={fieldSelectTriggerClass}>
          <SelectValue placeholder={t('inspector.account.chooseAccount')}>{selectedLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent
          container={container}
          align="start"
          alignItemWithTrigger={false}
          className={`${selectionMenuContentClass} w-max min-w-[max(9rem,var(--anchor-width))] max-w-(--available-width)`}
        >
          {missingSelected && (
            <SelectItem value={selectedId} disabled className={selectionMenuItemClass}>
              {selectedLabel}
            </SelectItem>
          )}
          {connections.map((candidate) => (
            <SelectItem key={candidate.connectionId} value={candidate.connectionId} className={selectionMenuItemClass}>
              {candidate.displayName}
              {candidate.isDefault ? ` (${t('inspector.account.teamDefault')})` : ''}
            </SelectItem>
          ))}
          <SelectSeparator className="mx-2 bg-border/50" />
          <SelectItem value={manageAccountOption} className={selectionMenuItemClass}>
            {t('inspector.account.addAccount')}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

export function inspectorIcon(node: ResolvedSelection | undefined, target: GraphTarget): IconName {
  if (node?.kind == 'trigger') return 'trigger'
  if (node?.kind == 'condition') return 'condition'
  if (node?.kind == 'value') return 'value'
  if (node?.kind == 'approval') return 'check'
  if (node?.kind == 'wait') return 'wait'
  if (node?.kind == 'subflow' || (node == null && target.kind == 'subflow')) return 'subflow'
  if (node?.kind == 'task' && node.definition != null && 'executor' in node.definition) {
    return node.definition.executor.kind == 'connector' ? 'connection' : 'llm'
  }
  return 'task'
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function arrayValue<Value extends readonly unknown[]>(value: string, label: string, t: TFunction): Value {
  const parsed = JSON.parse(value) as unknown
  if (!Array.isArray(parsed)) throw new TypeError(t('inspector.errors.portDefinitions', { label }))
  return parsed as unknown as Value
}

function inputUpstreamSources({
  revision,
  sourceNodeIcons,
  target,
  selection,
  store,
  handleName,
  t,
}: Pick<Props, 'revision' | 'sourceNodeIcons' | 'target' | 'store'> & {
  readonly selection: ResolvedNode
  readonly handleName: string
  readonly t: TFunction
}): NodeInputUpstreamSources | undefined {
  const graph = revision.graph(target)!
  const mapping = nodeInputMappings(selection.node)[handleName]
  const sources = mapping?.kind == 'sources' ? mapping.sources.filter((source) => source.kind == 'node') : []
  return {
    current: sources.map((source) => {
      const node = graph.nodes[source.nodeId]
      return {
        description:
          node == null
            ? revision.outputDescription(target, source.nodeId, source.output)
            : presentBuiltInOutputDescription(node, source.output, revision.outputDescription(target, source.nodeId, source.output), t),
        icon: sourceNodeIcons?.[source.nodeId],
        nodeId: source.nodeId,
        nodeName: node?.name,
        output: source.output,
        field: source.field,
        check: undefined,
      }
    }),
    query: revision.inputSource(target, selection.id, handleName),
    groups: [],
    describeGroups: (candidates) =>
      Object.entries(candidates).map(([nodeId, outputs]) => {
        const node = graph.nodes[nodeId]
        return {
          icon: sourceNodeIcons?.[nodeId],
          nodeId,
          nodeName: node?.name ?? nodeId,
          outputs: node == null ? outputs : presentBuiltInSourceCandidates(node, outputs, t),
        }
      }),
    onChange: (source) => {
      void store.setInputSource(selection.id, handleName, source)
    },
  }
}

function GeneralSettings({
  disabled,
  node,
  nodeId,
  store,
}: {
  readonly disabled: boolean
  readonly node: ResolvedNode['node']
  readonly nodeId: string
  readonly store: WorkspaceStore
}): ReactElement {
  const t = useTranslate()
  const [timeout, setTimeoutValue] = useState(node.timeoutMs == null ? '' : String(node.timeoutMs))
  const [limit, setLimit] = useState(node.maxExecutions == null ? '' : String(node.maxExecutions))
  const [limitError, setLimitError] = useState<string>()
  const [error, setError] = useState<string>()
  const inputId = `node-${nodeId}-timeout`

  useEffect(() => {
    setTimeoutValue(node.timeoutMs == null ? '' : String(node.timeoutMs))
    setError(undefined)
  }, [node.timeoutMs, nodeId])

  useEffect(() => {
    setLimit(node.maxExecutions == null ? '' : String(node.maxExecutions))
    setLimitError(undefined)
  }, [node.maxExecutions, nodeId])

  function saveLimit(source: string): void {
    const value = source.trim() == '' ? undefined : Number(source)
    if (value != null && (!Number.isSafeInteger(value) || value < 1)) {
      setLimitError(t('inspector.node.maxExecutionsError'))
      return
    }
    setLimitError(undefined)
    if (value == node.maxExecutions) return
    void store.saveNodeSettings(nodeId, { name: node.name, timeoutMs: node.timeoutMs, maxExecutions: value })
  }

  function save(source: string): void {
    const value = source.trim() == '' ? undefined : Number(source)
    if (value != null && (!Number.isInteger(value) || value < 1)) {
      setError(t('inspector.node.timeoutError'))
      return
    }
    setError(undefined)
    if (value == node.timeoutMs) return
    void store.saveNodeSettings(nodeId, {
      name: node.name,
      ...(node.maxExecutions == null ? {} : { maxExecutions: node.maxExecutions }),
      ...(value == null ? {} : { timeoutMs: value }),
    })
  }

  return (
    <details key={nodeId} className="inspector-disclosure" data-inspector-section="node">
      <summary>
        <Icon name="chevron-down" size={14} />
        <span className="inspector-disclosure-summary">
          <strong className="inspector-section-title-text">{t('inspector.node.title')}</strong>
        </span>
      </summary>
      <div className="inspector-disclosure-content node-settings">
        <FieldGroup>
          <Field data-invalid={limitError != null}>
            <FieldLabel htmlFor={`node-${nodeId}-limit`}>{t('inspector.node.maxExecutions')}</FieldLabel>
            <Input
              aria-invalid={limitError != null}
              readOnly={disabled}
              id={`node-${nodeId}-limit`}
              min="1"
              step="1"
              onChange={(event) => setLimit(event.target.value)}
              onBlur={(event) => saveLimit(event.currentTarget.value)}
              placeholder="1000"
              type="number"
              value={limit}
            />
            {limitError != null && <FieldError>{limitError}</FieldError>}
          </Field>
          {node.kind != 'approval' && node.kind != 'wait' && (
            <Field data-invalid={error != null}>
              <FieldLabel htmlFor={inputId}>{t('inspector.node.timeout')}</FieldLabel>
              <Input
                aria-invalid={error != null}
                readOnly={disabled}
                id={inputId}
                min="1"
                onChange={(event) => setTimeoutValue(event.target.value)}
                onBlur={(event) => save(event.currentTarget.value)}
                placeholder={t('common.default')}
                type="number"
                value={timeout}
              />
              {error != null && <FieldError>{error}</FieldError>}
            </Field>
          )}
        </FieldGroup>
      </div>
    </details>
  )
}

function ConnectorAccount({
  action,
  actionError,
  actionId,
  activeConnections,
  authorizationPending,
  connection,
  connectionError,
  connectionId,
  connectors,
  disabled,
  fieldIdPrefix,
  loading,
  taskId,
}: {
  readonly action: ConnectorAction | undefined
  readonly actionError: string | undefined
  readonly actionId: string
  readonly activeConnections: readonly ConnectorConnection[] | undefined
  readonly authorizationPending: boolean
  readonly connection: ConnectorConnection | undefined
  readonly connectionError: string | undefined
  readonly connectionId: string | undefined
  readonly connectors: ConnectorStore
  readonly disabled: boolean
  readonly fieldIdPrefix: string
  readonly loading: boolean
  readonly taskId: string
}): ReactElement {
  const t = useTranslate()
  const available = activeConnections ?? []
  const required = action?.authenticated == true && (connectionId == null || (activeConnections != null && connection?.status != 'active'))
  let onManage: (() => void) | undefined
  let content: ReactElement
  if (loading) {
    content = <p>{t('inspector.account.loading')}</p>
  } else if (actionError != null || action == null) {
    content = (
      <>
        <p>{actionError ?? t('inspector.account.statusUnavailable', { action: actionId })}</p>
        <Button disabled={disabled} onClick={() => void connectors.refresh(true)} size="sm" type="button" variant="secondary">
          {t('inspector.account.retry')}
        </Button>
      </>
    )
  } else if (connectionError != null) {
    content = (
      <>
        <p>{t('inspector.account.refreshFailed')}</p>
        <p className="connection-detail">{connectionError}</p>
        <Button disabled={disabled} onClick={() => void connectors.refresh(true)} size="sm" type="button" variant="secondary">
          {t('inspector.account.retry')}
        </Button>
      </>
    )
  } else if (connectionId == null && available.length == 0) {
    content = (
      <>
        {authorizationPending && <p>{t('inspector.account.authorizationPending')}</p>}
        <div className="connection-prompt">
          <p>{t('inspector.account.connectBeforeRun', { service: action.serviceName })}</p>
          <Button disabled={disabled} onClick={() => void connectors.connect(action.serviceId)} size="sm" type="button">
            <Icon data-icon="inline-start" name="plus" />
            {t('inspector.account.connectService', { service: action.serviceName })}
          </Button>
        </div>
      </>
    )
  } else {
    onManage = () => void connectors.connect(action.serviceId)
    let status: string | undefined
    if (connectionId != null) {
      if (connection == null) status = t('inspector.account.missing')
      else if (connection.status != 'active') status = t(`inspector.account.status.${connection.status}`)
    }
    content = (
      <>
        {authorizationPending && <p>{t('inspector.account.authorizationPending')}</p>}
        <Field className="connection-field">
          <FieldLabel className="sr-only" htmlFor={`${fieldIdPrefix}-connection`}>
            {t('inspector.account.connection')}
          </FieldLabel>
          <AccountSelect
            connections={available}
            disabled={disabled || available.length == 0}
            id={`${fieldIdPrefix}-connection`}
            selectedConnection={connection}
            selectedId={connectionId}
            onChange={(next) => void connectors.setConnection(taskId, next)}
            onManage={() => void connectors.connect(action.serviceId)}
          />
        </Field>
        {status != null && <p>{status}</p>}
      </>
    )
  }
  return (
    <section className={`connection-state ${required ? 'required' : ''}`} data-inspector-section="account">
      <h3 className="inspector-section-title">
        <Icon name="connection" size={15} /> {t(required ? 'inspector.account.required' : 'inspector.account.title')}
        {onManage != null && (
          <Button className="ml-auto" disabled={disabled} onClick={onManage} size="xs" type="button" variant="ghost">
            {t('inspector.account.manage')}
          </Button>
        )}
      </h3>
      <div className="connection-state-content">{content}</div>
    </section>
  )
}

function ResolutionDefinition({
  disabled,
  selection,
  store,
}: {
  readonly disabled: boolean
  readonly selection: Extract<ResolvedNode, { readonly kind: 'approval' | 'wait' }>
  readonly store: WorkspaceStore
}): ReactElement {
  const t = useTranslate()
  const node = selection.node
  const [prompt, setPrompt] = useState(node.prompt)
  const [error, setError] = useState<string>()
  useEffect(() => {
    setPrompt(node.prompt)
    setError(undefined)
  }, [node])
  const save = async (text = prompt): Promise<void> => {
    const value = text.trim()
    if (value.length == 0 || [...value].length > 1000) {
      setError(t('inspector.wait.promptError'))
      return
    }
    setError(undefined)
    await store.saveResolution(selection.id, { name: node.name, prompt: value })
  }
  return (
    <form
      className="inspector-form wait-form"
      data-inspector-section="resolution"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <FieldGroup>
        <Field className="inspector-field-section">
          <FieldLabel className="inspector-section-title" htmlFor={`wait-${selection.id}-prompt`}>
            {t('inspector.wait.prompt')}
          </FieldLabel>
          <Textarea
            id={`wait-${selection.id}-prompt`}
            readOnly={disabled}
            rows={3}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onBlur={(event) => {
              if (event.currentTarget.value.trim() != node.prompt) void save(event.currentTarget.value)
            }}
          />
        </Field>
        {error != null && <FieldError>{error}</FieldError>}
      </FieldGroup>
    </form>
  )
}

function TaskDefinition({
  children,
  connectors,
  disabled,
  focus,
  selection,
  store,
  theme,
}: {
  readonly children: ReactElement
  readonly connectors: ConnectorStore
  readonly disabled: boolean
  readonly focus?: DiagnosticFocus
  readonly selection: Extract<ResolvedNode, { readonly kind: 'task' }>
  readonly store: WorkspaceStore
  readonly theme: WorkbenchTheme
}): ReactElement | null {
  const actionCatalog = useVal(connectors.$.actions)
  const t = useTranslate()
  const task = selection.definition
  const module = selection.module
  const fieldIdPrefix = `task-${selection.id}`
  const moduleEditor = useVal(store.$.moduleEditor)
  const moduleLocation = focus?.section == 'module' ? focus.diagnostic : undefined

  if (task == null) return <div className="inspector-section section-error">{t('inspector.task.missing')}</div>
  const llm = 'executor' in task && task.executor.kind == 'llm' ? task.executor : undefined
  const codeEditor =
    module != null && 'moduleId' in task && moduleEditor?.moduleId == task.moduleId ? (
      <form
        className="inspector-form code-section"
        data-inspector-section="module"
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() == 's') {
            event.preventDefault()
            event.stopPropagation()
            if (!disabled) void store.saveModuleEditor()
          }
        }}
        onSubmit={(event) => {
          event.preventDefault()
          void store.saveModuleEditor()
        }}
      >
        <div className="inspector-section-title">{t('inspector.task.javascriptModule')}</div>
        <div className="code-section-content">
          <CodeActions
            key={`${moduleEditor.moduleId}-${selection.id}`}
            capabilities={task.capabilities ?? []}
            connectors={connectors}
            disabled={disabled || moduleEditor.status == 'saving'}
            nodeId={selection.id}
            store={store}
            context={contextName(moduleEditor.source) ?? 'context'}
          />
          <CodeEditor
            ariaLabel={t('inspector.task.source')}
            disabled={disabled}
            errorLabel={t('inspector.task.editorUnavailable')}
            loadingLabel={t('inspector.task.editorLoading')}
            location={moduleLocation == null ? undefined : { column: moduleLocation.column, line: moduleLocation.line }}
            onBlur={() => {
              if (store.hasUnsavedCode) void store.saveModuleEditor()
            }}
            onChange={(value) => store.updateModuleSource(value)}
            theme={theme}
            typing={codeTyping(task, task.capabilities, actionCatalog)}
            uri={`file:///modules/${moduleEditor.moduleId}.js`}
            value={moduleEditor.source}
          />
          <span className="code-source-note">{t('inspector.task.importsFromSource')}</span>
          {moduleEditor.status == 'failed' && (
            <div className="form-actions code-actions">
              <Button disabled={disabled} onClick={() => store.discardModuleChanges()} size="sm" type="button" variant="secondary">
                {t('inspector.task.discardCode')}
              </Button>
              <Button disabled={disabled} size="sm" type="submit">
                {t('inspector.task.retrySave')}
              </Button>
            </div>
          )}
        </div>
      </form>
    ) : undefined
  const taskDefinition = llm != null && (
    <Field className="inspector-field-section" data-inspector-section="task">
      <FieldLabel className="inspector-section-title">{t('inspector.task.definition')}</FieldLabel>
      <div className="node-settings">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${fieldIdPrefix}-response-mode`}>{t('inspector.task.responseMode')}</FieldLabel>
            <NativeSelect
              disabled={disabled}
              id={`${fieldIdPrefix}-response-mode`}
              onChange={(event) => {
                const mode = event.target.value
                if ((mode == 'chat' || mode == 'json') && mode != llm.mode) {
                  void store.saveTaskSettings(selection.id, { kind: 'llm', mode, name: task.name })
                }
              }}
              value={llm.mode}
            >
              <NativeSelectOption value="chat">{t('inspector.task.chatText')}</NativeSelectOption>
              <NativeSelectOption value="json">{t('inspector.task.structuredJson')}</NativeSelectOption>
            </NativeSelect>
          </Field>
        </FieldGroup>
      </div>
    </Field>
  )
  return (
    <>
      {taskDefinition}
      {codeEditor}
      {children}
    </>
  )
}

function SubflowDefinition({
  definition,
  disabled,
  store,
  subflowId,
}: {
  readonly definition: NonNullable<ReturnType<RevisionView['subflow']>>
  readonly disabled: boolean
  readonly store: WorkspaceStore
  readonly subflowId: string
}): ReactElement {
  const t = useTranslate()
  const [name, setName] = useState(definition.name)
  const [inputs, setInputs] = useState(json(definition.inputs))
  const [outputs, setOutputs] = useState(json(definition.outputs))
  const [error, setError] = useState<string>()

  useEffect(() => {
    setName(definition.name)
    setInputs(json(definition.inputs))
    setOutputs(json(definition.outputs))
    setError(undefined)
  }, [definition])

  return (
    <form
      className="inspector-section inspector-form"
      onSubmit={(event) => {
        event.preventDefault()
        try {
          const nextInputs = arrayValue<SubflowSettings['inputs']>(inputs, t('inspector.subflow.inputPorts'), t)
          const nextOutputs = arrayValue<SubflowSettings['outputs']>(outputs, t('inspector.subflow.outputPorts'), t)
          setError(undefined)
          void store.saveSubflowSettings(subflowId, { inputs: nextInputs, name: name.trim(), outputs: nextOutputs })
        } catch (parseError) {
          setError(parseError instanceof TypeError ? parseError.message : t('inspector.errors.portDefinitions'))
        }
      }}
    >
      <h3>{t('inspector.subflow.definition')}</h3>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`${subflowId}-name`}>{t('common.name')}</FieldLabel>
          <Input readOnly={disabled} id={`${subflowId}-name`} onChange={(event) => setName(event.target.value)} value={name} />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${subflowId}-inputs`}>{t('inspector.subflow.inputPorts')}</FieldLabel>
          <Textarea
            readOnly={disabled}
            id={`${subflowId}-inputs`}
            onChange={(event) => setInputs(event.target.value)}
            rows={8}
            spellCheck={false}
            value={inputs}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${subflowId}-outputs`}>{t('inspector.subflow.outputPorts')}</FieldLabel>
          <Textarea
            readOnly={disabled}
            id={`${subflowId}-outputs`}
            onChange={(event) => setOutputs(event.target.value)}
            rows={10}
            spellCheck={false}
            value={outputs}
          />
        </Field>
        {error != null && <FieldError>{error}</FieldError>}
      </FieldGroup>
      <div className="form-actions">
        <Button disabled={disabled || name.trim() == ''} size="sm" type="submit" variant="secondary">
          {t('inspector.subflow.save')}
        </Button>
      </div>
    </form>
  )
}

function TriggerConnection({
  activeConnections,
  authorizationPending,
  connection,
  connectionError,
  connectionLoading,
  disabled,
  selection,
  triggers,
}: {
  readonly activeConnections?: readonly ConnectorConnection[]
  readonly authorizationPending: boolean
  readonly connection?: ConnectorConnection
  readonly connectionError?: string
  readonly connectionLoading: boolean
  readonly disabled: boolean
  readonly selection: Extract<ResolvedSelection, { readonly kind: 'trigger' }>
  readonly triggers: TriggerStore
}): ReactElement | null {
  const t = useTranslate()
  const trigger = selection.trigger
  const providerTrigger = trigger.kind == 'poll' || trigger.kind == 'integration' ? trigger : undefined
  const fieldIdPrefix = `trigger-${selection.id}`
  const canManage = !connectionLoading && connectionError == null && (activeConnections?.length ?? 0) > 0
  const connectionSection =
    providerTrigger == null ? null : (
      <section className={`connection-state ${connection?.status == 'active' ? '' : 'required'}`} data-inspector-section="account">
        <h3 className="inspector-section-title">
          <Icon name="connection" size={15} /> {t(connection?.status == 'active' ? 'inspector.account.title' : 'inspector.account.required')}
          {canManage && (
            <Button
              className="ml-auto"
              disabled={disabled}
              onClick={() => void triggers.connect(providerTrigger.definition.provider)}
              size="xs"
              type="button"
              variant="ghost"
            >
              {t('inspector.account.manage')}
            </Button>
          )}
        </h3>
        <div className="connection-state-content">
          {authorizationPending && <p>{t('inspector.account.authorizationPending')}</p>}
          {connectionLoading ? (
            <p>{t('inspector.account.loading')}</p>
          ) : connectionError != null ? (
            <>
              <p>{t('inspector.account.refreshFailed')}</p>
              <p className="connection-detail">{connectionError}</p>
              <Button disabled={disabled} onClick={() => void triggers.refresh(true)} size="sm" type="button" variant="secondary">
                {t('inspector.account.retry')}
              </Button>
            </>
          ) : (activeConnections?.length ?? 0) == 0 ? (
            <div className="connection-prompt">
              <p>{t('inspector.account.connectBeforeRun', { service: providerTrigger.definition.provider })}</p>
              <Button disabled={disabled} onClick={() => void triggers.connect(providerTrigger.definition.provider)} size="sm" type="button">
                {t('inspector.account.connectService', { service: providerTrigger.definition.provider })}
              </Button>
            </div>
          ) : (
            <>
              <Field className="connection-field">
                <FieldLabel className="sr-only" htmlFor={`${fieldIdPrefix}-connection`}>
                  {t('inspector.account.connection')}
                </FieldLabel>
                <AccountSelect
                  connections={activeConnections!}
                  disabled={disabled}
                  id={`${fieldIdPrefix}-connection`}
                  selectedConnection={connection}
                  selectedId={connection?.connectionId}
                  onChange={(next) => void triggers.setConnection(selection.id, next)}
                  onManage={() => void triggers.connect(providerTrigger.definition.provider)}
                />
              </Field>
            </>
          )}
        </div>
      </section>
    )

  return connectionSection
}

interface Props {
  readonly variables: InputVariables
  readonly connectorAction?: ConnectorAction
  readonly connectorActionError?: string
  readonly connectorAuthorizationPending: boolean
  readonly connectorConnection?: ConnectorConnection
  readonly connectorConnectionError?: string
  readonly activeConnectorConnections?: readonly ConnectorConnection[]
  readonly connectors: ConnectorStore
  readonly connectorLoading: boolean
  readonly disabled: boolean
  readonly focus?: DiagnosticFocus
  readonly revision: RevisionView
  readonly selection: ResolvedSelection | undefined
  readonly sourceNodeIcons?: Readonly<Record<string, string | undefined>>
  readonly store: WorkspaceStore
  readonly theme: WorkbenchTheme
  readonly target: GraphTarget
  readonly triggerActiveConnections?: readonly ConnectorConnection[]
  readonly triggerAuthorizationPending: boolean
  readonly triggerConnection?: ConnectorConnection
  readonly triggerConnectionError?: string
  readonly triggerConnectionLoading: boolean
  readonly triggers: TriggerStore
}

export function NodeInspector({
  variables,
  connectorAction,
  connectorActionError,
  connectorAuthorizationPending,
  connectorConnection,
  connectorConnectionError,
  activeConnectorConnections,
  connectors,
  connectorLoading,
  disabled,
  focus,
  revision,
  selection,
  sourceNodeIcons,
  store,
  theme,
  target,
  triggerActiveConnections,
  triggerAuthorizationPending,
  triggerConnection,
  triggerConnectionError,
  triggerConnectionLoading,
  triggers,
}: Props): ReactElement {
  const t = useTranslate()
  const content = useRef<HTMLDivElement>(null)
  const task = selection?.kind == 'task' ? selection.definition : undefined
  const isAgent = task != null && 'executor' in task && task.executor.kind == 'agent'
  const isLlm = task != null && 'executor' in task && task.executor.kind == 'llm'
  const connector = task != null && 'executor' in task && task.executor.kind == 'connector' ? task.executor : undefined
  const taskId = selection?.kind == 'task' && selection.node.task == null ? selection.node.taskId : undefined
  const locatedRequest = useRef<number>()
  useEffect(() => {
    if (focus == null) return
    if (locatedRequest.current == focus.requestId) return
    const section = content.current?.querySelector<HTMLElement>(`[data-inspector-section="${focus.section}"]`)
    if (section == null) return
    locatedRequest.current = focus.requestId
    if (section instanceof HTMLDetailsElement) section.open = true
    for (let parent = section.parentElement; parent != null && parent != content.current; parent = parent.parentElement) {
      if (parent instanceof HTMLDetailsElement) parent.open = true
    }
    section.scrollIntoView({ block: 'nearest' })
    section.classList.remove('diagnostic-located')
    void section.offsetWidth
    section.classList.add('diagnostic-located')
    const timer = globalThis.setTimeout(() => section.classList.remove('diagnostic-located'), 1_200)
    return () => globalThis.clearTimeout(timer)
  }, [focus, selection?.id, selection?.kind])

  return (
    <NativeScrollArea className="inspector-scroll" tabIndex={-1}>
      <div className="inspector-content" ref={content}>
        {selection?.kind == 'trigger' && !(selection.trigger.kind == 'integration' && selection.trigger.definition.key == 'feishu_app_bot.on_event') && (
          <TriggerConnection
            activeConnections={triggerActiveConnections}
            authorizationPending={triggerAuthorizationPending}
            connection={triggerConnection}
            connectionError={triggerConnectionError}
            connectionLoading={triggerConnectionLoading}
            disabled={disabled}
            selection={selection}
            triggers={triggers}
          />
        )}
        {connector != null && taskId != null && connectorAction?.authenticated !== false && (
          <ConnectorAccount
            action={connectorAction}
            actionError={connectorActionError}
            actionId={connector.action}
            activeConnections={activeConnectorConnections}
            authorizationPending={connectorAuthorizationPending}
            connection={connectorConnection}
            connectionError={connectorConnectionError}
            connectionId={connector.connectionId}
            connectors={connectors}
            disabled={disabled}
            fieldIdPrefix={`task-${selection?.id}`}
            loading={connectorLoading}
            taskId={taskId}
          />
        )}
        {selection?.kind == 'task' && selection.definition != null && 'executor' in selection.definition && selection.definition.executor.kind == 'agent' && (
          <AgentSettings
            key={JSON.stringify([store.$.flowId.value, selection.id])}
            task={selection.definition}
            nodeId={selection.id}
            store={store}
            connectors={connectors}
            disabled={disabled}
            theme={theme}
          />
        )}
        {selection != null && (
          <NodeDescription
            key={`description:${selection.id}`}
            value={selection.node.description}
            disabled={disabled}
            onSave={(description) => {
              void store.saveNodeDescription(selection.id, description)
            }}
          />
        )}
        {selection?.kind === 'trigger' && <TriggerSummary trigger={selection.trigger} />}
        {selection?.kind === 'trigger' &&
          (selection.trigger.kind === 'integration' || selection.trigger.kind === 'poll') &&
          (['feishu.on_event', 'feishu_app_bot.on_event'].includes(selection.trigger.definition.key) ? (
            <FeishuTriggerConfig config={selection.trigger.config} nodeId={selection.id} disabled={disabled} store={store} />
          ) : selection.trigger.definition.key === 'linear.on_issue_changed' ? (
            <LinearTriggerConfig
              config={selection.trigger.config}
              nodeId={selection.id}
              connectionId={
                revision.binding(selection.trigger.bindingId)?.kind === 'connection' ? revision.binding(selection.trigger.bindingId)!.target : undefined
              }
              disabled={disabled}
              store={store}
            />
          ) : (
            <TriggerConfigEditor
              key={`config:${selection.id}`}
              schema={selection.trigger.definition.configSchema}
              config={selection.trigger.config}
              disabled={disabled}
              onChange={(name, value) => {
                void store.saveTriggerConfig(selection.id, name, value)
              }}
            />
          ))}
        {selection?.kind === 'trigger' && selection.trigger.kind === 'webhook' && (
          <WebhookEditor
            key={`webhook:${selection.id}`}
            bodyFields={selection.trigger.bodyFields}
            options={selection.trigger.options ?? {}}
            disabled={disabled}
            onChange={(settings, deletion) => {
              void store.saveWebhook(selection.id, settings, deletion)
            }}
          />
        )}
        {selection?.kind === 'trigger' && (selection.trigger.kind === 'cron' || selection.trigger.kind === 'poll') && (
          <TriggerScheduleEditor
            key={`schedule:${selection.id}`}
            schedules={selection.trigger.kind === 'cron' ? selection.trigger.cronTimes : selection.trigger.pollTimes}
            disabled={disabled}
            onChange={(schedule) => {
              void store.saveTriggerSchedule(selection.id, schedule)
            }}
          />
        )}
        {(selection?.kind === 'approval' || selection?.kind === 'wait' || selection?.kind === 'subflow' || selection?.kind === 'task') &&
          (() => {
            const definitions: (InputPort | Group)[] =
              selection.kind === 'task'
                ? [...(selection.definition?.inputs ?? [])]
                : selection.kind === 'subflow'
                  ? [...(selection.definition?.inputs ?? [])]
                  : [...selection.node.inputDefinitions]
            const handles = new Set(definitions.flatMap((definition) => ('handle' in definition ? [definition.handle] : [])))
            for (const handle of Object.keys(selection.node.inputs)) {
              if (!handles.has(handle) && !(selection.kind === 'task' && selection.node.additionalInputs?.some((port) => port.handle === handle)))
                definitions.push({ handle, jsonSchema: {}, nullable: true })
            }
            const entries = definitions.map((definition): Group | NodeInputField => {
              if ('group' in definition) return definition
              const mapping = selection.node.inputs[definition.handle]
              const source = mapping?.kind === 'sources' ? mapping.sources.find((item) => item.kind === 'binding') : undefined
              const binding = source?.kind === 'binding' ? revision.binding(source.bindingId) : undefined
              return {
                definition,
                value: mapping?.kind === 'value' ? mapping.value : definition.value,
                connected: mapping?.kind === 'sources' && binding?.kind !== 'variable',
                variableName: binding?.kind === 'variable' ? binding.target : undefined,
              }
            })
            const fields = (
              <NodeInputs
                key={`inputs:${selection.id}`}
                allowAddGroup={selection.kind !== 'wait' && selection.kind !== 'approval'}
                title={t('inspector.ports.inputsTitle')}
                entries={entries}
                onDefinitions={
                  selection.kind === 'task' && selection.definition != null && (selection.node.task != null || isAgent)
                    ? (inputs, deletion) => {
                        void store.saveTaskPorts(selection.id, { inputs, outputs: selection.definition!.outputs }, deletion)
                      }
                    : selection.kind === 'wait' || selection.kind === 'approval'
                      ? (inputs, deletion) => {
                          void store.saveResolution(
                            selection.id,
                            {
                              name: selection.node.name,
                              prompt: selection.node.prompt,
                              inputDefinitions: inputs.filter((port): port is InputPort => 'handle' in port),
                            },
                            deletion,
                          )
                        }
                      : undefined
                }
                renderSource={(handle) => inputUpstreamSources({ revision, sourceNodeIcons, target, selection, store, handleName: handle, t })}
                variables={variables}
                disabled={disabled}
                onValue={(handle, value, deletion) => {
                  void store.setInputValue(selection.id, handle, value, deletion)
                }}
                onVariable={(handle, name) => {
                  void store.setInputVariable(selection.id, handle, name)
                }}
              />
            )
            return (
              <section className="inspector-port-section" data-inspector-section="inputs">
                {fields}
                {selection.kind === 'task' && selection.definition != null && selection.node.task == null && isLlm && (
                  <section className="inspector-nested-port-section">
                    <NodeInputs
                      key={`additional:${selection.id}`}
                      title={t('inspector.task.additionalInputs')}
                      allowAddGroup={false}
                      entries={(selection.node.additionalInputs ?? []).map((definition) => {
                        const mapping = selection.node.inputs[definition.handle]
                        const source = mapping?.kind === 'sources' ? mapping.sources.find((item) => item.kind === 'binding') : undefined
                        const binding = source?.kind === 'binding' ? revision.binding(source.bindingId) : undefined
                        return {
                          definition,
                          value: mapping?.kind === 'value' ? mapping.value : definition.value,
                          connected: mapping?.kind === 'sources' && binding?.kind !== 'variable',
                          variableName: binding?.kind === 'variable' ? binding.target : undefined,
                        }
                      })}
                      variables={variables}
                      disabled={disabled}
                      reservedNames={selection.definition.inputs.flatMap((port) => ('handle' in port ? [port.handle] : []))}
                      onDefinitions={(inputs, deletion) => {
                        void store.saveTaskAdditionalInputs(
                          selection.id,
                          inputs.filter((port): port is InputPort => 'handle' in port),
                          deletion,
                        )
                      }}
                      onValue={(handle, value, deletion) => {
                        void store.setInputValue(selection.id, handle, value, deletion)
                      }}
                      onVariable={(handle, name) => {
                        void store.setInputVariable(selection.id, handle, name)
                      }}
                      renderSource={(handle) => inputUpstreamSources({ revision, sourceNodeIcons, target, selection, store, handleName: handle, t })}
                    />
                  </section>
                )}
              </section>
            )
          })()}
        {selection?.kind === 'condition' && (
          <ConditionBranchesEditor
            key={`condition:${selection.id}`}
            value={selection.node}
            disabled={disabled}
            variables={variables}
            renderSource={(handle) => inputUpstreamSources({ revision, sourceNodeIcons, target, selection, store, handleName: handle, t })}
            variableName={(source) => (source.kind === 'binding' ? revision.binding(source.bindingId)?.target : undefined)}
            sourceType={(source) => revision.sourceType(target, source)}
            onVariable={(handle, name) => {
              void store.setInputVariable(selection.id, handle, name)
            }}
            onChange={(settings, deletion) => {
              void store.saveCondition(selection.id, settings, deletion)
            }}
          />
        )}
        {selection?.kind === 'value' && (
          <div className="inspector-values-section">
            <PortDefinitionEditor
              layout="values"
              values={selection.node.values}
              disabled={disabled}
              onChange={(values, deletion) => {
                void store.saveValue(selection.id, values, deletion)
              }}
            />
          </div>
        )}
        {selection?.kind === 'task' && selection.definition != null && (
          <section className="inspector-port-section">
            <PortDefinitionEditor
              groups
              layout="ports"
              title={t('inspector.ports.outputsTitle')}
              output
              values={selection.definition.outputs}
              disabled={disabled || !(selection.node.task != null || isAgent)}
              onChange={(outputs, deletion) => {
                void store.saveTaskPorts(selection.id, { inputs: selection.definition!.inputs, outputs }, deletion)
              }}
            />
          </section>
        )}
        {(selection?.kind === 'subflow' || selection?.kind === 'approval' || selection?.kind === 'wait') && (
          <section className="inspector-port-section">
            <PortDefinitionEditor
              groups
              layout="ports"
              title={t('inspector.ports.outputsTitle')}
              output
              disabled
              values={selection.kind === 'subflow' ? (selection.definition?.outputs ?? []) : presentResolutionOutputs(selection.node, t)}
              onChange={() => {}}
            />
          </section>
        )}
        {selection == null ? (
          target.kind == 'subflow' ? (
            <SubflowDefinition definition={revision.subflow(target.id)!} disabled={disabled} store={store} subflowId={target.id} />
          ) : (
            <div className="inspector-empty">{t('inspector.selectNode')}</div>
          )
        ) : (
          <>
            {selection.kind == 'trigger' ? null : selection.kind == 'task' ? (
              <TaskDefinition connectors={connectors} disabled={disabled} focus={focus} selection={selection} store={store} theme={theme}>
                <GeneralSettings disabled={disabled} node={selection.node} nodeId={selection.id} store={store} />
              </TaskDefinition>
            ) : selection.kind == 'approval' || selection.kind == 'wait' ? (
              <ResolutionDefinition disabled={disabled} selection={selection} store={store} />
            ) : null}
            {selection.kind != 'trigger' && selection.kind != 'task' && (
              <GeneralSettings disabled={disabled} node={selection.node} nodeId={selection.id} store={store} />
            )}
            {selection.kind == 'subflow' && (
              <section className="inspector-section">
                <h3>{t('inspector.subflow.referenced')}</h3>
                <p className="reference-value">{selection.definition?.name ?? selection.node.subflowId}</p>
              </section>
            )}
          </>
        )}
      </div>
    </NativeScrollArea>
  )
}
