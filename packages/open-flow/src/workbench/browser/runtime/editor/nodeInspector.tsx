import type { ReactElement } from 'react'
import type { TFunction } from 'val-i18n'
import type { TriggerDisplay } from '../../../../control/common/triggerCatalog.ts'
import type { GraphNode, GraphTarget } from '../../../../flow/common/change.ts'
import type { ConnectorAccess, ConnectorAccessCandidates, ConnectorAction, ConnectorConnection, Diagnostic, Group, InputPort } from '../api.ts'
import type { ConnectorActionView } from '../connectionCatalog.ts'
import type { WorkbenchTheme } from '../contract.ts'
import type { IconName } from '../icons.tsx'
import type { ResolvedNode, ResolvedSelection, RevisionView } from '../revisionView.ts'
import type { ConnectorActionError, ConnectorStore } from '../stores/connectorStore.ts'
import type { TriggerStore } from '../stores/triggerStore.ts'
import type { WorkspaceStore } from '../stores/workspaceStore.ts'
import type { DiagnosticFocus } from './diagnostics.ts'
import type { NodeInputField } from './nodeInputs.tsx'
import type { InputVariables, NodeInputUpstreamSources } from './sourceValueEditor.tsx'

import { useEffect, useRef } from 'react'
import { useTranslate } from 'val-i18n-react'
import { decisionModel } from '../../../../decision/common/decision.ts'
import { nodeInputMappings } from '../../../../flow/common/condition.ts'
import { inputValue } from '../../../../flow/common/inputValue.ts'
import { Button } from '../../../../ui/browser/button.tsx'
import { Field, FieldLabel } from '../../../../ui/browser/field.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { ScrollArea } from '../../../../ui/browser/scroll-area.tsx'
import { AgentSettingsProvider, AgentPrompt, AgentAdvancedSettings } from './agentSettings.tsx'
import {
  presentBuiltInOutputDescription,
  presentBuiltInSourceCandidates,
  presentDecisionOutputs,
  presentResolutionOutputs,
} from './builtInOutputPresentation.ts'
import { CodeTaskSection } from './codeTaskSection.tsx'
import { ConditionBranchesEditor } from './conditionBranchesEditor.tsx'
import { ConnectorAccount, TriggerConnection, SavedConnectionReference } from './connectionSettings.tsx'
import { DecisionSection } from './decisionSection.tsx'
import { ErrorTriggerSources, ErrorTriggerSourcesEditor } from './errorTriggerSources.tsx'
import { FeishuTriggerConfig } from './feishuTriggerConfig.tsx'
import { GeneralSettings } from './generalSettings.tsx'
import { LinearTriggerConfig } from './linearTriggerConfig.tsx'
import { LlmTaskSection } from './llmTaskSection.tsx'
import { NodeDescription } from './nodeDescription.tsx'
import { NodeInputs } from './nodeInputs.tsx'
import { NodeInputValue } from './nodeInputValue.tsx'
import { OpenApiSection } from './openApiSection.tsx'
import { PortDefinitionEditor } from './portDefinitionEditor.tsx'
import { presentProviderOutputDescription, presentProviderSourceCandidates, presentProviderTriggerConfig } from './providerTriggerPresentation.ts'
import { ResolutionDefinition } from './resolutionDefinition.tsx'
import { SubflowDefinition } from './subflowDefinition.tsx'
import { TriggerConfigEditor } from './triggerConfigEditor.tsx'
import { TriggerScheduleEditor } from './triggerScheduleEditor.tsx'
import { TriggerSummary } from './triggerSummary.tsx'
import { WebhookEditor } from './webhookEditor.tsx'

export function inspectorIcon(node: ResolvedSelection | undefined, target: GraphTarget): IconName {
  if (node?.kind == 'trigger') return 'trigger'
  if (node?.kind == 'condition') return 'condition'
  if (node?.kind == 'value') return 'value'
  if (node?.kind == 'approval') return 'check'
  if (node?.kind == 'wait') return 'wait'
  if (node?.kind == 'subflow' || (node == null && target.kind == 'subflow')) return 'subflow'
  if (node?.kind == 'task' && node.definition != null && 'executor' in node.definition) {
    if (node.definition.executor.kind == 'decision') return 'decision'
    if (node.definition.executor.kind == 'openapi') return 'task'
    return node.definition.executor.kind == 'connector' ? 'connection' : 'llm'
  }
  return 'task'
}

function nodePurposePlaceholder(
  selection: ResolvedSelection,
  t: TFunction,
  action?: ConnectorAction,
  displays?: Readonly<Record<string, TriggerDisplay>>,
): string | undefined {
  switch (selection.kind) {
    case 'condition':
      return t('addNode.conditionDescription')
    case 'value':
      return t('addNode.valueDescription')
    case 'approval':
      return t('addNode.approvalDescription')
    case 'wait':
      return t('addNode.waitDescription')
    case 'subflow':
      return t('addNode.subflowDescription')
    case 'trigger': {
      const node = selection.node
      switch (node.kind) {
        case 'manual':
          return t('addNode.manualDescription')
        case 'error':
          return t('errorWorkflow.description')
        case 'cron':
          return t('addNode.cronDescription')
        case 'webhook':
          return t('addNode.webhookDescription')
        case 'integration':
        case 'poll':
          return displays?.[node.definition.key]?.description ?? node.definition.description
      }
    }
    case 'task': {
      const definition = selection.definition
      if (definition == null) return
      if (!('executor' in definition)) return t('addNode.javascriptDescription')
      switch (definition.executor.kind) {
        case 'agent':
          return t('addNode.agentDescription')
        case 'decision':
          return t('decision.description')
        case 'openapi':
          return t('openapi.description')
        case 'connector':
          return action?.description
        case 'llm':
          return t(definition.executor.mode == 'json' ? 'addNode.llmStructuredDescription' : 'addNode.llmChatDescription')
      }
    }
  }
}

function inputUpstreamSources({
  revision,
  sourceNodeIcons,
  target,
  selection,
  store,
  handleName,
  t,
  triggerDisplays,
}: Pick<Props, 'revision' | 'sourceNodeIcons' | 'target' | 'store' | 'triggerDisplays'> & {
  readonly selection: ResolvedNode
  readonly handleName: string
  readonly t: TFunction
}): NodeInputUpstreamSources | undefined {
  const graph = revision.graph(target)!
  const mapping = nodeInputMappings(selection.node)[handleName]
  const sources = mapping?.kind == 'sources' ? mapping.sources.filter((source) => source.kind == 'node') : []
  const providerDisplay = (node: GraphNode | undefined) =>
    node?.kind == 'integration' || node?.kind == 'poll' ? triggerDisplays?.[node.definition.key] : undefined
  return {
    current: sources.map((source) => {
      const node = graph.nodes[source.nodeId]
      return {
        description:
          node == null
            ? revision.outputDescription(target, source.nodeId, source.output)
            : presentProviderOutputDescription(
                node,
                source.output,
                presentBuiltInOutputDescription(node, source.output, revision.outputDescription(target, source.nodeId, source.output), t),
                providerDisplay(node),
              ),
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
          outputs: node == null ? outputs : presentProviderSourceCandidates(node, presentBuiltInSourceCandidates(node, outputs, t), providerDisplay(node)),
        }
      }),
    onChange:
      store == null
        ? undefined
        : (source) => {
            void store.setInputSource(selection.id, handleName, source)
          },
  }
}

interface Props {
  readonly readOnly?: boolean
  readonly onOpenSubflow?: (id: string) => void
  readonly variables?: InputVariables
  readonly connectorAction?: ConnectorAction
  readonly connectorActionError?: ConnectorActionError
  readonly connectorAccessError?: string
  readonly connectorAuthorizationPending?: boolean
  readonly connectorConnection?: ConnectorConnection
  readonly connectorConnectionError?: string
  readonly activeConnectorConnections?: readonly ConnectorConnection[]
  readonly connectors?: ConnectorStore
  readonly connectorCandidates?: Readonly<Record<string, ConnectorAccessCandidates | undefined>>
  readonly connectorAccess?: ConnectorAccess
  readonly onConfigureConnectorAccess?: (providerId?: string) => void
  readonly prepareConnectorAction?: (
    action: ConnectorActionView,
  ) => Promise<{ readonly action: ConnectorActionView; readonly connections: readonly ConnectorConnection[] } | undefined>
  readonly connectorLoading?: boolean
  readonly disabled?: boolean
  readonly diagnostics?: readonly Diagnostic[]
  readonly focus?: DiagnosticFocus
  readonly revision: RevisionView
  readonly selection: ResolvedSelection | undefined
  readonly sourceNodeIcons?: Readonly<Record<string, string | undefined>>
  readonly store?: WorkspaceStore
  readonly theme: WorkbenchTheme
  readonly target: GraphTarget
  readonly triggerActiveConnections?: readonly ConnectorConnection[]
  readonly triggerAuthorizationPending?: boolean
  readonly triggerConnection?: ConnectorConnection
  readonly triggerConnectionError?: string
  readonly triggerConnectionLoading?: boolean
  readonly triggerDisplays?: Readonly<Record<string, TriggerDisplay>>
  readonly triggers?: TriggerStore
}

type InspectorProps = Props &
  (
    | { readonly readOnly: true; readonly store?: never; readonly connectors?: never; readonly triggers?: never; readonly variables?: never }
    | {
        readonly readOnly?: false
        readonly store: WorkspaceStore
        readonly connectors: ConnectorStore
        readonly triggers: TriggerStore
        readonly variables: InputVariables
      }
  )

export function NodeInspector({
  variables = { enabled: false, loaded: false, loading: false, names: [], onOpen: undefined },
  readOnly = false,
  onOpenSubflow,
  connectorAction,
  connectorActionError,
  connectorAccessError,
  connectorAuthorizationPending = false,
  connectorConnection,
  connectorConnectionError,
  activeConnectorConnections,
  connectors: liveConnectors,
  connectorAccess,
  connectorCandidates,
  onConfigureConnectorAccess,
  prepareConnectorAction,
  connectorLoading = false,
  disabled: temporarilyDisabled = false,
  diagnostics,
  focus,
  revision,
  selection,
  sourceNodeIcons,
  store: writableStore,
  theme,
  target,
  triggerActiveConnections,
  triggerAuthorizationPending = false,
  triggerConnection,
  triggerConnectionError,
  triggerConnectionLoading = false,
  triggerDisplays,
  triggers: liveTriggers,
}: InspectorProps): ReactElement {
  const store = readOnly ? undefined : writableStore
  const connectors = readOnly ? undefined : liveConnectors
  const triggers = readOnly ? undefined : liveTriggers
  const disabled = readOnly || temporarilyDisabled || store == null
  const t = useTranslate()
  const content = useRef<HTMLDivElement>(null)
  const task = selection?.kind == 'task' ? selection.definition : undefined
  const isAgent = task != null && 'executor' in task && task.executor.kind == 'agent'
  const isDecision = task != null && 'executor' in task && task.executor.kind == 'decision'
  const isOpenApi = task != null && 'executor' in task && task.executor.kind == 'openapi'
  const unconfiguredOpenApi = task != null && 'executor' in task && task.executor.kind == 'openapi' && !task.executor.path
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

  const panel = (
    <ScrollArea className="inspector-scroll" tabIndex={-1}>
      <div className="inspector-content" ref={content}>
        {readOnly && connector != null && <SavedConnectionReference action={connector.action} connectionId={connector.connectionId} />}
        {readOnly && selection?.kind === 'trigger' && (selection.trigger.kind === 'poll' || selection.trigger.kind === 'integration') && (
          <SavedConnectionReference action={selection.trigger.definition.key} connectionId={selection.trigger.connectionId} />
        )}
        {!readOnly && triggers != null && selection?.kind == 'trigger' && (
          <TriggerConnection
            activeConnections={triggerActiveConnections}
            authorizationPending={triggerAuthorizationPending}
            connection={triggerConnection}
            connectionError={triggerConnectionError}
            connectionLoading={triggerConnectionLoading}
            disabled={disabled}
            selection={selection}
            triggers={triggers}
            onConfigureAccess={(providerId) => void triggers.connect(providerId)}
          />
        )}
        {!readOnly && connectors != null && connector != null && taskId != null && connectorAction?.authenticated !== false && (
          <ConnectorAccount
            action={connectorAction}
            actionError={connectorActionError}
            accessError={connectorAccessError}
            actionId={connector.action}
            onConfigureAccess={() => void connectors.connect(connectorAction?.serviceId ?? connector.action.split('.')[0]!)}
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
        {selection != null && (
          <NodeDescription
            key={`description:${selection.id}`}
            value={selection.node.description}
            placeholder={nodePurposePlaceholder(selection, t, connectorAction, triggerDisplays)}
            disabled={disabled}
            onSave={(description) => {
              void store?.saveNodeDescription(selection.id, description)
            }}
          />
        )}
        {isAgent && <AgentPrompt />}
        {selection?.kind === 'task' && selection.module != null && (
          <CodeTaskSection
            readOnly={readOnly}
            connectorAccess={connectorAccess}
            connectorCandidates={connectorCandidates}
            onConfigureAccess={onConfigureConnectorAccess == null ? undefined : () => onConfigureConnectorAccess()}
            connectors={connectors}
            prepareAction={prepareConnectorAction}
            disabled={disabled}
            diagnostics={diagnostics}
            focus={focus}
            selection={selection}
            store={store}
            theme={theme}
          />
        )}
        {selection?.kind === 'trigger' &&
          (selection.trigger.kind === 'integration' || selection.trigger.kind === 'poll') &&
          (!readOnly && store != null && ['feishu.on_event', 'feishu_app_bot.on_event'].includes(selection.trigger.definition.key) ? (
            <FeishuTriggerConfig
              inputs={presentProviderTriggerConfig(selection.trigger.definition.configInputs, triggerDisplays?.[selection.trigger.definition.key])}
              fieldLabels={triggerDisplays?.[selection.trigger.definition.key]?.configInputLabels}
              config={selection.trigger.config}
              nodeId={selection.id}
              connectionId={selection.trigger.connectionId}
              disabled={disabled}
              store={store}
            />
          ) : !readOnly && store != null && selection.trigger.definition.key === 'linear.on_issue_changed' ? (
            <LinearTriggerConfig
              inputs={presentProviderTriggerConfig(selection.trigger.definition.configInputs, triggerDisplays?.[selection.trigger.definition.key])}
              fieldLabels={triggerDisplays?.[selection.trigger.definition.key]?.configInputLabels}
              config={selection.trigger.config}
              nodeId={selection.id}
              connectionId={selection.trigger.connectionId}
              disabled={disabled}
              store={store}
            />
          ) : (
            <TriggerConfigEditor
              readOnly={readOnly}
              key={`config:${selection.id}`}
              onReset={() => {
                return store?.resetTriggerConfig(selection.id)
              }}
              onResetValue={(name) => {
                void store?.resetTriggerConfig(selection.id, [name])
              }}
              inputs={presentProviderTriggerConfig(selection.trigger.definition.configInputs, triggerDisplays?.[selection.trigger.definition.key])}
              fieldLabels={triggerDisplays?.[selection.trigger.definition.key]?.configInputLabels}
              config={selection.trigger.config}
              disabled={disabled}
              onChange={(name, value) => {
                void store?.saveTriggerConfig(selection.id, name, value)
              }}
            />
          ))}
        {selection?.kind === 'trigger' && selection.trigger.kind === 'error' && (
          <>
            {store == null ? (
              <ErrorTriggerSources
                flows={[]}
                flowId={revision.revision.flowId}
                value={selection.trigger.sourceFlowIds ?? []}
                disabled
                complete={false}
                onChange={() => {}}
              />
            ) : (
              <ErrorTriggerSourcesEditor store={store} nodeId={selection.id} value={selection.trigger.sourceFlowIds ?? []} disabled={disabled} />
            )}
          </>
        )}
        {selection?.kind === 'trigger' && selection.trigger.kind !== 'webhook' && (
          <TriggerSummary
            trigger={selection.trigger}
            display={
              selection.trigger.kind == 'integration' || selection.trigger.kind == 'poll' ? triggerDisplays?.[selection.trigger.definition.key] : undefined
            }
          />
        )}
        {selection?.kind === 'trigger' && selection.trigger.kind === 'webhook' && (
          <WebhookEditor
            readOnly={readOnly}
            key={`webhook:${selection.id}`}
            bodyFields={selection.trigger.bodyFields}
            method={selection.trigger.method}
            options={selection.trigger.options ?? {}}
            disabled={disabled}
            outputSection={<TriggerSummary trigger={selection.trigger} />}
            onChange={(settings, deletion) => {
              void store?.saveWebhook(selection.id, settings, deletion)
            }}
          />
        )}
        {selection?.kind === 'trigger' && (selection.trigger.kind === 'cron' || selection.trigger.kind === 'poll') && (
          <TriggerScheduleEditor
            key={`schedule:${selection.id}`}
            schedules={selection.trigger.kind === 'cron' ? selection.trigger.cronTimes : selection.trigger.pollTimes}
            disabled={disabled}
            collapsible={selection.trigger.kind === 'poll'}
            onChange={(schedule) => {
              void store?.saveTriggerSchedule(selection.id, schedule)
            }}
          />
        )}
        {selection?.kind === 'task' && task != null && 'executor' in task && task.executor.kind === 'decision' && (
          <DecisionSection
            key={`decision:${selection.id}`}
            task={task}
            disabled={disabled}
            onSave={(before, value, deletion) =>
              store?.saveTaskSettings(selection.id, { kind: 'decision', name: task.name, before, task: value }, deletion) ?? Promise.resolve(false)
            }
          />
        )}
        {isOpenApi && task != null && 'executor' in task && (
          <OpenApiSection
            key={`openapi:${selection?.id}`}
            task={task}
            credentials={(onInvalidChange) =>
              selection?.kind === 'task' &&
              task.inputs
                .filter((port): port is InputPort => 'handle' in port && port.handle.startsWith('auth.'))
                .map((definition) => {
                  const mapping = selection.node.inputs[definition.handle]
                  const source = mapping?.kind === 'sources' ? mapping.sources.find((item) => item.kind === 'binding') : undefined
                  const binding = source?.kind === 'binding' ? revision.binding(source.bindingId) : undefined
                  return (
                    <Field key={definition.handle}>
                      <FieldLabel>
                        {definition.handle
                          .slice(5)
                          .replace(/^manual\./, '')
                          .replaceAll('.', ' · ')}
                      </FieldLabel>
                      <NodeInputValue
                        embedded
                        definition={definition}
                        label={
                          task.executor.kind == 'openapi' && task.executor.auth.length == 1
                            ? definition.handle.split('.').at(-1)
                            : definition.handle.slice(5).replaceAll('.', ' · ')
                        }
                        presentation={{ compact: true, hideOptions: true }}
                        onInvalidChange={onInvalidChange}
                        sourceOnly
                        readOnly={readOnly}
                        disabled={disabled}
                        value={inputValue(mapping, definition.value)}
                        connected={mapping?.kind === 'sources' && binding?.kind !== 'variable'}
                        variableName={binding?.kind === 'variable' ? binding.target : undefined}
                        upstream={inputUpstreamSources({
                          revision,
                          sourceNodeIcons,
                          target,
                          selection,
                          store,
                          handleName: definition.handle,
                          t,
                          triggerDisplays,
                        })}
                        variables={variables}
                        onValue={(value, deletion) => {
                          void store?.setInputValue(selection.id, definition.handle, value, deletion)
                        }}
                        onVariable={(name) => {
                          void store?.setInputVariable(selection.id, definition.handle, name)
                        }}
                      />
                    </Field>
                  )
                })
            }
            disabled={disabled}
            load={(url, signal) => store!.loadOpenApiDocument(url, signal)}
            onSave={(before, value) =>
              store?.saveTaskSettings(selection!.id, { kind: 'openapi', name: task.name, before, task: value }) ?? Promise.resolve(false)
            }
          />
        )}
        {!unconfiguredOpenApi &&
          (selection?.kind === 'approval' || selection?.kind === 'wait' || selection?.kind === 'subflow' || selection?.kind === 'task') &&
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
            const entries = definitions
              .filter((definition) => !isOpenApi || !('handle' in definition) || !definition.handle.startsWith('auth.'))
              .map((definition): Group | NodeInputField => {
                if ('group' in definition) return definition
                if (
                  selection.kind === 'task' &&
                  selection.definition != null &&
                  'executor' in selection.definition &&
                  selection.definition.executor.kind === 'decision' &&
                  definition.handle === 'target'
                ) {
                  definition = { ...definition, description: t('decision.targetDescription') }
                }
                const mapping = selection.node.inputs[definition.handle]
                const source = mapping?.kind === 'sources' ? mapping.sources.find((item) => item.kind === 'binding') : undefined
                const binding = source?.kind === 'binding' ? revision.binding(source.bindingId) : undefined
                return {
                  definition,
                  value: inputValue(mapping, definition.value),
                  onReset: definition.value !== undefined && mapping != null ? () => void store?.resetInputs(selection.id, [definition.handle]) : undefined,
                  connected: mapping?.kind === 'sources' && binding?.kind !== 'variable',
                  variableName: binding?.kind === 'variable' ? binding.target : undefined,
                }
              })
            const fields = (
              <NodeInputs
                readOnly={readOnly}
                key={`inputs:${selection.id}`}
                allowAddGroup={selection.kind !== 'wait' && selection.kind !== 'approval'}
                title={t('inspector.ports.inputsTitle')}
                entries={entries}
                onReset={() => {
                  return store?.resetInputs(
                    selection.id,
                    entries.flatMap((entry) => ('group' in entry ? [] : [entry.definition.handle])),
                  )
                }}
                onDefinitions={
                  selection.kind === 'task' && selection.definition != null && (selection.node.task != null || isAgent)
                    ? (inputs, deletion, values) => {
                        void store?.saveTaskPorts(selection.id, { inputs, outputs: selection.definition!.outputs }, deletion, values)
                      }
                    : selection.kind === 'wait' || selection.kind === 'approval'
                      ? (inputs, deletion, values) => {
                          void store?.saveResolution(
                            selection.id,
                            {
                              name: selection.node.name,
                              prompt: selection.node.prompt,
                              inputDefinitions: inputs.filter((port): port is InputPort => 'handle' in port),
                            },
                            deletion,
                            values,
                          )
                        }
                      : undefined
                }
                renderSource={(handle) => inputUpstreamSources({ revision, sourceNodeIcons, target, selection, store, handleName: handle, t, triggerDisplays })}
                variables={variables}
                disabled={disabled}
                onValue={(handle, value, deletion) => {
                  void store?.setInputValue(selection.id, handle, value, deletion)
                }}
                onVariable={(handle, name) => {
                  void store?.setInputVariable(selection.id, handle, name)
                }}
              />
            )
            return (
              <section className="inspector-port-section" data-inspector-section="inputs">
                {fields}
                {selection.kind === 'task' && selection.definition != null && selection.node.task == null && isLlm && (
                  <section className="inspector-nested-port-section">
                    <NodeInputs
                      readOnly={readOnly}
                      key={`additional:${selection.id}`}
                      title={t('inspector.task.additionalInputs')}
                      allowAddGroup={false}
                      entries={(selection.node.additionalInputs ?? []).map((definition) => {
                        const mapping = selection.node.inputs[definition.handle]
                        const source = mapping?.kind === 'sources' ? mapping.sources.find((item) => item.kind === 'binding') : undefined
                        const binding = source?.kind === 'binding' ? revision.binding(source.bindingId) : undefined
                        return {
                          definition,
                          value: inputValue(mapping, definition.value),
                          onReset:
                            definition.value !== undefined && mapping != null ? () => void store?.resetInputs(selection.id, [definition.handle]) : undefined,
                          connected: mapping?.kind === 'sources' && binding?.kind !== 'variable',
                          variableName: binding?.kind === 'variable' ? binding.target : undefined,
                        }
                      })}
                      variables={variables}
                      disabled={disabled}
                      reservedNames={selection.definition.inputs.flatMap((port) => ('handle' in port ? [port.handle] : []))}
                      onDefinitions={(inputs, deletion, values) => {
                        void store?.saveTaskAdditionalInputs(
                          selection.id,
                          inputs.filter((port): port is InputPort => 'handle' in port),
                          deletion,
                          values,
                        )
                      }}
                      onValue={(handle, value, deletion) => {
                        void store?.setInputValue(selection.id, handle, value, deletion)
                      }}
                      onVariable={(handle, name) => {
                        void store?.setInputVariable(selection.id, handle, name)
                      }}
                      renderSource={(handle) =>
                        inputUpstreamSources({ revision, sourceNodeIcons, target, selection, store, handleName: handle, t, triggerDisplays })
                      }
                    />
                  </section>
                )}
              </section>
            )
          })()}
        {selection?.kind === 'condition' && (
          <ConditionBranchesEditor
            readOnly={readOnly}
            key={`condition:${selection.id}`}
            value={selection.node}
            disabled={disabled}
            variables={variables}
            renderSource={(handle) => inputUpstreamSources({ revision, sourceNodeIcons, target, selection, store, handleName: handle, t, triggerDisplays })}
            variableName={(source) => (source.kind === 'binding' ? revision.binding(source.bindingId)?.target : undefined)}
            sourceType={(source) => revision.sourceType(target, source)}
            onVariable={(handle, name) => {
              void store?.setInputVariable(selection.id, handle, name)
            }}
            onChange={(settings, deletion) => {
              void store?.saveCondition(selection.id, settings, deletion)
            }}
          />
        )}
        {selection?.kind === 'value' && (
          <div className="inspector-values-section">
            <PortDefinitionEditor
              readOnly={readOnly}
              layout="values"
              values={selection.node.values}
              disabled={disabled}
              onChange={(values, deletion) => {
                void store?.saveValue(selection.id, values, deletion)
              }}
            />
          </div>
        )}
        {!unconfiguredOpenApi && selection?.kind === 'task' && selection.definition != null && (
          <section className="inspector-port-section">
            <PortDefinitionEditor
              readOnly={readOnly}
              groups
              layout="ports"
              title={t('inspector.ports.outputsTitle')}
              output
              values={presentDecisionOutputs(selection.definition, t)}
              disabled={disabled || !(selection.node.task != null || isAgent)}
              onChange={(outputs, deletion) => {
                void store?.saveTaskPorts(selection.id, { inputs: selection.definition!.inputs, outputs }, deletion)
              }}
            />
          </section>
        )}
        {(selection?.kind === 'subflow' || selection?.kind === 'approval' || selection?.kind === 'wait') && (
          <section className="inspector-port-section">
            <PortDefinitionEditor
              readOnly={readOnly}
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
              selection.definition == null ? (
                <div className="inspector-section section-error">{t('inspector.task.missing')}</div>
              ) : (
                <>
                  {isLlm && <LlmTaskSection selection={selection} disabled={disabled} store={store} />}
                  <GeneralSettings
                    readOnly={readOnly}
                    title={isAgent || isDecision ? t('agent.more') : undefined}
                    disabled={disabled}
                    node={selection.node}
                    nodeId={selection.id}
                    store={store}
                  >
                    {isAgent && <AgentAdvancedSettings />}
                    {isDecision && (
                      <Field>
                        <FieldLabel htmlFor={`${selection.id}-model`}>{t('agent.model')}</FieldLabel>
                        <Input id={`${selection.id}-model`} readOnly value={decisionModel} />
                      </Field>
                    )}
                  </GeneralSettings>
                </>
              )
            ) : selection.kind == 'approval' || selection.kind == 'wait' ? (
              <ResolutionDefinition disabled={disabled} selection={selection} store={store} />
            ) : null}
            {selection.kind != 'trigger' && selection.kind != 'task' && (
              <GeneralSettings readOnly={readOnly} disabled={disabled} node={selection.node} nodeId={selection.id} store={store} />
            )}
            {selection.kind == 'subflow' && (
              <section className="inspector-section">
                <h3>{t('inspector.subflow.referenced')}</h3>
                <p className="reference-value">{selection.definition?.name ?? selection.node.subflowId}</p>
                {onOpenSubflow != null && selection.definition != null && (
                  <Button className="self-start" size="sm" variant="outline" onClick={() => onOpenSubflow(selection.node.subflowId)}>
                    {t('inspector.subflow.open')}
                  </Button>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </ScrollArea>
  )
  return selection?.kind == 'task' && task != null && 'executor' in task && task.executor.kind == 'agent' ? (
    <AgentSettingsProvider
      readOnly={readOnly}
      key={JSON.stringify([revision.revision.flowId, selection.id])}
      task={task}
      nodeId={selection.id}
      store={store}
      connectors={connectors}
      prepareAction={prepareConnectorAction}
      disabled={disabled}
      theme={theme}
    >
      {panel}
    </AgentSettingsProvider>
  ) : (
    panel
  )
}
