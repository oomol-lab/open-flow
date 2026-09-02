import type { ReactElement } from 'react'
import type { TFunction } from 'val-i18n'
import type { TriggerSettings } from '../../../../flow/common/nodeChanges.ts'
import type { ConnectorAction, ConnectorConnection, Diagnostic, JsonValue } from '../api.ts'
import type { WorkbenchTheme } from '../contract.ts'
import type { IconName } from '../icons.tsx'
import type { ResolvedNode, ResolvedSelection, RevisionView } from '../revisionView.ts'
import type { ConnectorStore } from '../stores/connectorStore.ts'
import type { TriggerStore } from '../stores/triggerStore.ts'
import type { ModuleEditorStatus } from '../stores/workspaceModel.ts'
import type { WorkspaceStore } from '../stores/workspaceStore.ts'
import type { DiagnosticFocus } from './diagnostics.ts'
import type { DesignerTarget, SubflowSettings, TaskSettings } from './flowChanges.ts'

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useLang, useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '../../../../ui/browser/field.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { NativeSelect, NativeSelectOption } from '../../../../ui/browser/native-select.tsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../../ui/browser/tabs.tsx'
import { Textarea } from '../../../../ui/browser/textarea.tsx'
import { ToggleGroup, ToggleGroupItem } from '../../../../ui/browser/toggle-group.tsx'
import { Icon } from '../icons.tsx'
import { CodeEditor } from './codeEditor.tsx'
import { diagnosticMessage } from './diagnostics.ts'
import { codeTyping } from './flowChanges.ts'
import { taskDiagnosticReady, taskInspectorSection } from './nodeInspectorBehavior.ts'

const WaitNotificationInputs = lazy(async () => {
  const module = await import('./waitNotificationInputs.tsx')
  return { default: module.WaitNotificationInputs }
})

export function inspectorIcon(node: ResolvedSelection | undefined, target: DesignerTarget): IconName {
  if (node?.kind == 'trigger') return 'trigger'
  if (node?.kind == 'condition') return 'condition'
  if (node?.kind == 'value') return 'value'
  if (node?.kind == 'wait') return 'wait'
  if (node?.kind == 'subflow' || (node == null && target.kind == 'subflow')) return 'subflow'
  if (node?.kind == 'task' && node.definition != null && 'executor' in node.definition) {
    return node.definition.executor.kind == 'llm' ? 'llm' : 'connection'
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

function codeStatusLabel(status: ModuleEditorStatus, t: TFunction): string {
  switch (status) {
    case 'dirty':
      return t('inspector.task.codeDirty')
    case 'failed':
      return t('inspector.task.codeFailed')
    case 'saved':
      return t('inspector.task.codeSaved')
    case 'saving':
      return t('inspector.task.codeSaving')
  }
}

function Diagnostics({ diagnostics }: { readonly diagnostics: readonly Diagnostic[] }): ReactElement | null {
  const t = useTranslate()
  if (diagnostics.length == 0) return null
  const incomplete = diagnostics.every((diagnostic) => diagnostic.code == 'trigger.config-incomplete')
  return (
    <section className={`inspector-section diagnostics-section ${incomplete ? 'incomplete' : ''}`}>
      <h3>
        <Icon name="alert" size={15} /> {t(incomplete ? 'inspector.configurationRequired' : 'inspector.diagnostics')}
      </h3>
      <div className="diagnostic-list">
        {diagnostics.map((diagnostic, index) => (
          <div className="diagnostic-item" key={`${diagnostic.path}:${diagnostic.line}:${diagnostic.column}:${index}`}>
            <strong>{diagnosticMessage(diagnostic, t)}</strong>
            <code>
              {diagnostic.code} · {diagnostic.line}:{diagnostic.column}
            </code>
          </div>
        ))}
      </div>
    </section>
  )
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
  const [name, setName] = useState(node.name ?? '')
  const [concurrency, setConcurrency] = useState(String(node.concurrency))
  const [timeout, setTimeoutValue] = useState(node.timeoutMs == null ? '' : String(node.timeoutMs))
  const [error, setError] = useState<string>()
  const fieldIdPrefix = `node-${nodeId}`

  useEffect(() => {
    setName(node.name ?? '')
    setConcurrency(String(node.concurrency))
    setTimeoutValue(node.timeoutMs == null ? '' : String(node.timeoutMs))
    setError(undefined)
  }, [node])

  return (
    <details className="inspector-disclosure" data-inspector-section="node">
      <summary>
        <Icon name="chevron-down" size={14} />
        <span className="inspector-disclosure-summary">
          <strong>{t('inspector.node.title')}</strong>
          <span>{t('inspector.node.description')}</span>
        </span>
      </summary>
      <form
        className="inspector-form inspector-disclosure-content"
        onSubmit={(event) => {
          event.preventDefault()
          const concurrencyValue = Number(concurrency)
          const timeoutValue = timeout == '' ? undefined : Number(timeout)
          if (!Number.isInteger(concurrencyValue) || concurrencyValue < 1) {
            setError(t('inspector.node.concurrencyError'))
            return
          }
          if (timeoutValue != null && (!Number.isInteger(timeoutValue) || timeoutValue < 1)) {
            setError(t('inspector.node.timeoutError'))
            return
          }
          setError(undefined)
          void store.saveNodeSettings(nodeId, {
            concurrency: concurrencyValue,
            ...(name.trim() == '' ? {} : { name: name.trim() }),
            ...(timeoutValue == null ? {} : { timeoutMs: timeoutValue }),
          })
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${fieldIdPrefix}-name`}>{t('inspector.node.displayName')}</FieldLabel>
            <Input
              disabled={disabled}
              id={`${fieldIdPrefix}-name`}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('inspector.node.displayNamePlaceholder')}
              value={name}
            />
          </Field>
          <div className="field-pair">
            <Field>
              <FieldLabel htmlFor={`${fieldIdPrefix}-concurrency`}>{t('inspector.node.concurrency')}</FieldLabel>
              <Input
                disabled={disabled}
                id={`${fieldIdPrefix}-concurrency`}
                min="1"
                onChange={(event) => setConcurrency(event.target.value)}
                type="number"
                value={concurrency}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${fieldIdPrefix}-timeout`}>{t('inspector.node.timeout')}</FieldLabel>
              <Input
                disabled={disabled}
                id={`${fieldIdPrefix}-timeout`}
                min="1"
                onChange={(event) => setTimeoutValue(event.target.value)}
                placeholder={t('common.default')}
                type="number"
                value={timeout}
              />
            </Field>
          </div>
          {error != null && <FieldError>{error}</FieldError>}
        </FieldGroup>
        <div className="form-actions">
          <Button disabled={disabled} size="sm" type="submit" variant="secondary">
            {t('inspector.node.save')}
          </Button>
        </div>
      </form>
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
  return (
    <section className={`inspector-section connection-state ${required ? 'required' : ''}`} data-inspector-section="account">
      <h3>
        <Icon name="connection" size={15} /> {t('inspector.account.title')}
      </h3>
      {loading ? (
        <p>{t('inspector.account.loading')}</p>
      ) : actionError != null || action == null ? (
        <>
          <p>{actionError ?? t('inspector.account.statusUnavailable', { action: actionId })}</p>
          <Button disabled={disabled} onClick={() => void connectors.refresh(true)} size="sm" type="button" variant="secondary">
            {t('inspector.account.retry')}
          </Button>
        </>
      ) : connectionError != null ? (
        <>
          <p>{t('inspector.account.refreshFailed')}</p>
          <p className="connection-detail">{connectionError}</p>
          <Button disabled={disabled} onClick={() => void connectors.refresh(true)} size="sm" type="button" variant="secondary">
            {t('inspector.account.retry')}
          </Button>
        </>
      ) : connectionId == null ? (
        available.length > 0 ? (
          <>
            {authorizationPending && <p>{t('inspector.account.authorizationPending')}</p>}
            <Field className="connection-field">
              <FieldLabel htmlFor={`${fieldIdPrefix}-connection`}>{t('inspector.account.connection')}</FieldLabel>
              <NativeSelect
                disabled={disabled}
                id={`${fieldIdPrefix}-connection`}
                onChange={(event) => void connectors.setConnection(taskId, event.target.value)}
                value=""
              >
                <NativeSelectOption disabled value="">
                  {t('inspector.account.chooseAccount')}
                </NativeSelectOption>
                {available.map((candidate) => (
                  <NativeSelectOption key={candidate.connectionId} value={candidate.connectionId}>
                    {candidate.displayName}
                    {candidate.isDefault ? ` (${t('inspector.account.teamDefault')})` : ''}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Button disabled={disabled} onClick={() => void connectors.connect(action.serviceId)} size="sm" type="button" variant="secondary">
              <Icon data-icon="inline-start" name="plus" /> {t('inspector.account.addConnection')}
            </Button>
          </>
        ) : (
          <>
            {authorizationPending && <p>{t('inspector.account.authorizationPending')}</p>}
            <p>{t('inspector.account.connectBeforeRun', { service: action.serviceName })}</p>
            <Button disabled={disabled} onClick={() => void connectors.connect(action.serviceId)} size="sm" type="button">
              {t('inspector.account.connectService', { service: action.serviceName })}
            </Button>
          </>
        )
      ) : (
        <>
          {authorizationPending && <p>{t('inspector.account.authorizationPending')}</p>}
          <Field className="connection-field">
            <FieldLabel htmlFor={`${fieldIdPrefix}-connection`}>{t('inspector.account.connection')}</FieldLabel>
            <NativeSelect
              disabled={disabled || available.length == 0}
              id={`${fieldIdPrefix}-connection`}
              onChange={(event) => void connectors.setConnection(taskId, event.target.value)}
              value={connectionId}
            >
              {connection?.status != 'active' && (
                <NativeSelectOption disabled value={connectionId}>
                  {connection?.displayName ?? connectionId} ({t('inspector.account.unavailable')})
                </NativeSelectOption>
              )}
              {available.map((candidate) => (
                <NativeSelectOption key={candidate.connectionId} value={candidate.connectionId}>
                  {candidate.displayName}
                  {candidate.isDefault ? ` (${t('inspector.account.teamDefault')})` : ''}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          {connection == null ? (
            <p>{t('inspector.account.missing')}</p>
          ) : connection.status == 'active' ? (
            <p>{t('inspector.account.pinned')}</p>
          ) : (
            <p>{t(`inspector.account.status.${connection.status}`)}</p>
          )}
          <Button disabled={disabled} onClick={() => void connectors.connect(action.serviceId)} size="sm" type="button" variant="secondary">
            <Icon data-icon="inline-start" name="plus" /> {t('inspector.account.addConnection')}
          </Button>
        </>
      )}
    </section>
  )
}

function WaitDefinition({
  activeConnectorConnections,
  connectorAction,
  connectorActionError,
  connectorAuthorizationPending,
  connectorConnection,
  connectorConnectionError,
  connectorLoading,
  connectors,
  disabled,
  onChooseNotification,
  revision,
  selection,
  store,
  theme,
}: {
  readonly activeConnectorConnections: readonly ConnectorConnection[] | undefined
  readonly connectorAction: ConnectorAction | undefined
  readonly connectorActionError: string | undefined
  readonly connectorAuthorizationPending: boolean
  readonly connectorConnection: ConnectorConnection | undefined
  readonly connectorConnectionError: string | undefined
  readonly connectorLoading: boolean
  readonly connectors: ConnectorStore
  readonly disabled: boolean
  readonly onChooseNotification: (button: HTMLButtonElement) => void
  readonly revision: RevisionView
  readonly selection: Extract<ResolvedNode, { readonly kind: 'wait' }>
  readonly store: WorkspaceStore
  readonly theme: WorkbenchTheme
}): ReactElement {
  const language = useLang()
  const t = useTranslate()
  const node = selection.node
  const [name, setName] = useState(node.name ?? '')
  const [mode, setMode] = useState<'approval' | 'continue'>(node.actions.length == 1 ? 'continue' : 'approval')
  const [notificationTaskId, setNotificationTaskId] = useState(node.notification?.taskId ?? '')
  const [messageHandle, setMessageHandle] = useState(node.notification?.messageHandle ?? '')
  const [prompt, setPrompt] = useState(node.prompt)
  const [error, setError] = useState<string>()
  const [inputAttempted, setInputAttempted] = useState(false)
  const fieldIdPrefix = `wait-${selection.id}`
  const savedMode = node.actions.length == 1 ? 'continue' : 'approval'
  const notificationTask = notificationTaskId == '' ? undefined : revision.task(notificationTaskId)
  const notificationName = (connectorAction?.name ?? notificationTask?.name ?? '').replaceAll('_', ' ')
  const ports = useMemo(() => notificationTask?.inputs.flatMap((port) => ('handle' in port ? [port] : [])) ?? [], [notificationTask])
  const messageHandles = ports.map((port) => port.handle)
  const currentInputs = useMemo(
    () => (node.notification?.taskId == notificationTaskId ? node.notification.inputs : {}),
    [node.notification, notificationTaskId],
  )
  const mappedHandles = useMemo(
    () => Object.entries(currentInputs).flatMap(([handle, mapping]) => (mapping.kind == 'sources' ? [handle] : [])),
    [currentInputs],
  )
  const inputDefinitions = useMemo(
    () =>
      ports.flatMap((port) =>
        port.handle == messageHandle || Object.hasOwn(port, 'value') || mappedHandles.includes(port.handle)
          ? []
          : [
              {
                ...(port.description == null ? {} : { description: port.description }),
                handle: port.handle,
                jsonSchema: port.jsonSchema,
                nullable: port.nullable ?? false,
              },
            ],
      ),
    [mappedHandles, messageHandle, ports],
  )
  const savedValues = Object.fromEntries(
    Object.entries(currentInputs).flatMap(([handle, mapping]) => (mapping.kind == 'value' ? [[handle, mapping.value] as const] : [])),
  )
  const [notificationValues, setNotificationValues] = useState<Readonly<Record<string, JsonValue>>>(savedValues)
  const [inputsValid, setInputsValid] = useState(inputDefinitions.length == 0)

  useEffect(() => {
    setName(node.name ?? '')
    setMode(node.actions.length == 1 ? 'continue' : 'approval')
    setNotificationTaskId(node.notification?.taskId ?? '')
    setMessageHandle(node.notification?.messageHandle ?? '')
    setNotificationValues(
      Object.fromEntries(
        Object.entries(node.notification?.inputs ?? {}).flatMap(([handle, mapping]) => (mapping.kind == 'value' ? [[handle, mapping.value] as const] : [])),
      ),
    )
    setPrompt(node.prompt)
    setError(undefined)
    setInputAttempted(false)
  }, [node])

  useEffect(() => setInputsValid(inputDefinitions.length == 0), [inputDefinitions])

  const save = async (validateInputs = true, nextMode = mode, nextNotificationTaskId = notificationTaskId): Promise<boolean> => {
    const value = prompt.trim()
    if (value.length == 0 || [...value].length > 1_000) {
      setError(t('inspector.wait.promptError'))
      return false
    }
    let notification: typeof node.notification
    if (nextNotificationTaskId != '') {
      if (notificationTask?.executor.kind != 'connector' || !messageHandles.includes(messageHandle)) {
        setError(t('inspector.wait.notificationUnavailable'))
        return false
      }
      if (validateInputs && !inputsValid) {
        setInputAttempted(true)
        setError(t('inspector.wait.inputsInvalid'))
        return false
      }
      const mappedInputs = Object.fromEntries(Object.entries(currentInputs).filter(([, mapping]) => mapping.kind == 'sources'))
      notification = {
        inputs: {
          ...mappedInputs,
          ...Object.fromEntries(Object.entries(notificationValues).map(([handle, input]) => [handle, { kind: 'value' as const, value: input }])),
        },
        messageHandle,
        taskId: nextNotificationTaskId,
      }
    }
    setError(undefined)
    return await store.saveWait(selection.id, {
      actions: nextMode == 'continue' ? ['continue'] : ['approve', 'reject'],
      ...(name.trim() == '' ? {} : { name: name.trim() }),
      notification,
      prompt: value,
    })
  }

  const chooseNotification = async (button: HTMLButtonElement): Promise<void> => {
    if (name.trim() == (node.name ?? '') && prompt.trim() == node.prompt && mode == savedMode) {
      onChooseNotification(button)
      return
    }
    if (await save(false)) onChooseNotification(button)
  }

  return (
    <>
      <form
        className="inspector-section inspector-form wait-form"
        data-inspector-section="wait"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${fieldIdPrefix}-name`}>{t('common.name')}</FieldLabel>
            <Input disabled={disabled} id={`${fieldIdPrefix}-name`} onChange={(event) => setName(event.target.value)} value={name} />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${fieldIdPrefix}-prompt`}>{t('inspector.wait.prompt')}</FieldLabel>
            <Textarea disabled={disabled} id={`${fieldIdPrefix}-prompt`} onChange={(event) => setPrompt(event.target.value)} rows={3} value={prompt} />
          </Field>
          <Field>
            <FieldLabel>{t('inspector.wait.mode')}</FieldLabel>
            <ToggleGroup<'approval' | 'continue'>
              aria-label={t('inspector.wait.mode')}
              className="wait-mode-switcher"
              disabled={disabled}
              onValueChange={(values) => {
                const value = values.at(-1)
                if (value == null || value == mode) return
                setMode(value)
                void save(false, value).then((saved) => {
                  if (!saved) setMode(savedMode)
                })
              }}
              spacing={0}
              size="sm"
              value={[mode]}
              variant="default"
            >
              <ToggleGroupItem value="continue">{t('inspector.wait.continue')}</ToggleGroupItem>
              <ToggleGroupItem value="approval">{t('inspector.wait.approval')}</ToggleGroupItem>
            </ToggleGroup>
          </Field>
          <Field>
            <FieldLabel>{t('inspector.wait.notificationTask')}</FieldLabel>
            {notificationTask == null ? (
              <Button disabled={disabled} onClick={(event) => void chooseNotification(event.currentTarget)} size="sm" type="button" variant="secondary">
                <Icon data-icon="inline-start" name="plus" /> {t('inspector.wait.chooseNotification')}
              </Button>
            ) : (
              <div className="wait-notification-summary">
                <Icon name="connection" size={16} />
                <span>{connectorAction == null ? notificationName : `${connectorAction.serviceName} · ${notificationName}`}</span>
                <Button disabled={disabled} onClick={(event) => void chooseNotification(event.currentTarget)} size="sm" type="button" variant="ghost">
                  {t('inspector.wait.changeNotification')}
                </Button>
                <Button
                  aria-label={t('inspector.wait.removeNotification')}
                  disabled={disabled}
                  onClick={() => {
                    void save(false, mode, '').then((saved) => {
                      if (!saved) return
                      setNotificationTaskId('')
                      setMessageHandle('')
                      setNotificationValues({})
                    })
                  }}
                  size="icon-sm"
                  title={t('inspector.wait.removeNotification')}
                  type="button"
                  variant="ghost"
                >
                  <Icon name="close" />
                </Button>
              </div>
            )}
          </Field>
          {notificationTask != null && messageHandles.length > 1 && (
            <Field>
              <FieldLabel htmlFor={`${fieldIdPrefix}-message-handle`}>{t('inspector.wait.messageHandle')}</FieldLabel>
              <NativeSelect
                disabled={disabled}
                id={`${fieldIdPrefix}-message-handle`}
                onChange={(event) => setMessageHandle(event.target.value)}
                value={messageHandle}
              >
                {messageHandles.map((handle) => (
                  <NativeSelectOption key={handle} value={handle}>
                    {handle}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          )}
          {notificationTask != null && inputDefinitions.length > 0 && (
            <Field>
              <FieldLabel>{t('inspector.wait.inputs')}</FieldLabel>
              <fieldset className="wait-notification-inputs" disabled={disabled}>
                <Suspense fallback={<FieldDescription>{t('inspector.wait.inputsLoading')}</FieldDescription>}>
                  <WaitNotificationInputs
                    definitions={inputDefinitions}
                    key={`${notificationTaskId}:${messageHandle}`}
                    language={language}
                    onChange={setNotificationValues}
                    onValidChange={setInputsValid}
                    showErrors={inputAttempted}
                    theme={theme}
                    values={notificationValues}
                  />
                </Suspense>
              </fieldset>
            </Field>
          )}
          {error != null && <FieldError>{error}</FieldError>}
        </FieldGroup>
        <div className="form-actions">
          <Button disabled={disabled} size="sm" type="submit" variant="secondary">
            {t('inspector.wait.save')}
          </Button>
        </div>
      </form>
      {notificationTask?.executor.kind == 'connector' && connectorAction?.authenticated !== false && (
        <ConnectorAccount
          action={connectorAction}
          actionError={connectorActionError}
          actionId={notificationTask.executor.action}
          activeConnections={activeConnectorConnections}
          authorizationPending={connectorAuthorizationPending}
          connection={connectorConnection}
          connectionError={connectorConnectionError}
          connectionId={notificationTask.executor.connectionId}
          connectors={connectors}
          disabled={disabled}
          fieldIdPrefix={fieldIdPrefix}
          loading={connectorLoading}
          taskId={notificationTaskId}
        />
      )}
    </>
  )
}

function TaskDefinition({
  children,
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
  onSectionChange,
  section,
  selection,
  store,
  theme,
}: {
  readonly children: ReactElement
  readonly connectorAction: ConnectorAction | undefined
  readonly connectorActionError: string | undefined
  readonly connectorAuthorizationPending: boolean
  readonly connectorConnection: ConnectorConnection | undefined
  readonly connectorConnectionError: string | undefined
  readonly activeConnectorConnections: readonly ConnectorConnection[] | undefined
  readonly connectors: ConnectorStore
  readonly connectorLoading: boolean
  readonly disabled: boolean
  readonly focus?: DiagnosticFocus
  readonly onSectionChange: (section: 'code' | 'settings') => void
  readonly section: 'code' | 'settings'
  readonly selection: Extract<ResolvedNode, { readonly kind: 'task' }>
  readonly store: WorkspaceStore
  readonly theme: WorkbenchTheme
}): ReactElement | null {
  const t = useTranslate()
  const node = selection.node
  const taskId = node.task == null ? node.taskId : undefined
  const task = selection.definition
  const module = selection.module
  const [name, setName] = useState(task?.name ?? '')
  const [llmMode, setLlmMode] = useState<'chat' | 'json'>(task != null && 'executor' in task && task.executor.kind == 'llm' ? task.executor.mode : 'chat')
  const fieldIdPrefix = `task-${selection.id}`
  const moduleDiagnostics = useVal(store.$.moduleDiagnostics)
  const moduleEditor = useVal(store.$.moduleEditor)
  const moduleLocation = focus?.section == 'module' ? focus.diagnostic : focus == null ? moduleDiagnostics[0] : undefined

  useEffect(() => {
    setName(task?.name ?? '')
    setLlmMode(task != null && 'executor' in task && task.executor.kind == 'llm' ? task.executor.mode : 'chat')
  }, [module, task])

  if (task == null) return <div className="inspector-section section-error">{t('inspector.task.missing')}</div>
  const connector = 'executor' in task && task.executor.kind == 'connector' ? task.executor : undefined
  const codeEditor =
    module != null && 'moduleId' in task && moduleEditor?.moduleId == task.moduleId ? (
      <form
        className="inspector-section inspector-form code-section"
        data-inspector-section="module"
        onSubmit={(event) => {
          event.preventDefault()
          void store.saveModuleEditor()
        }}
      >
        <div className="code-section-heading">
          <h3>{t('inspector.task.javascriptModule')}</h3>
          <span className={`code-save-status ${moduleEditor.status}`} aria-live="polite">
            <span /> {codeStatusLabel(moduleEditor.status, t)}
          </span>
        </div>
        <CodeEditor
          ariaLabel={t('inspector.task.source')}
          disabled={disabled || moduleEditor.status == 'saving'}
          errorLabel={t('inspector.task.editorUnavailable')}
          loadingLabel={t('inspector.task.editorLoading')}
          location={moduleLocation == null ? undefined : { column: moduleLocation.column, line: moduleLocation.line }}
          onChange={(value) => store.updateModuleSource(value)}
          theme={theme}
          typing={codeTyping(task)}
          uri={`file:///modules/${moduleEditor.moduleId}.js`}
          value={moduleEditor.source}
        />
        <span className="code-source-note">{t('inspector.task.importsFromSource')}</span>
        <div className="form-actions code-actions">
          {(moduleEditor.status == 'dirty' || moduleEditor.status == 'failed') && (
            <Button disabled={disabled} onClick={() => store.discardModuleChanges()} size="sm" type="button" variant="secondary">
              {t('inspector.task.discardCode')}
            </Button>
          )}
          <Button disabled={disabled || moduleEditor.status == 'saved' || moduleEditor.status == 'saving'} size="sm" type="submit">
            {t('inspector.task.saveCode')}
          </Button>
        </div>
      </form>
    ) : undefined
  const settingsPanel = (
    <>
      {children}
      <details className="inspector-disclosure" data-inspector-section="task">
        <summary>
          <Icon name="chevron-down" size={14} />
          <span className="inspector-disclosure-summary">
            <strong>{t('inspector.task.definition')}</strong>
            <span>{t('inspector.task.definitionDescription')}</span>
          </span>
        </summary>
        <form
          className="inspector-form inspector-disclosure-content"
          onSubmit={(event) => {
            event.preventDefault()
            let settings: TaskSettings
            if ('moduleId' in task) {
              settings = { kind: 'code', name: name.trim() }
            } else if (task.executor.kind == 'llm') {
              settings = { kind: 'llm', mode: llmMode, name: name.trim() }
            } else {
              settings = { kind: 'connector', name: name.trim() }
            }
            void store.saveTaskSettings(selection.id, settings)
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`${fieldIdPrefix}-name`}>{t('common.name')}</FieldLabel>
              <Input disabled={disabled} id={`${fieldIdPrefix}-name`} onChange={(event) => setName(event.target.value)} value={name} />
            </Field>
            {'executor' in task && task.executor.kind == 'llm' && (
              <Field>
                <FieldLabel htmlFor={`${fieldIdPrefix}-response-mode`}>{t('inspector.task.responseMode')}</FieldLabel>
                <NativeSelect
                  disabled={disabled}
                  id={`${fieldIdPrefix}-response-mode`}
                  onChange={(event) => setLlmMode(event.target.value as 'chat' | 'json')}
                  value={llmMode}
                >
                  <NativeSelectOption value="chat">{t('inspector.task.chatText')}</NativeSelectOption>
                  <NativeSelectOption value="json">{t('inspector.task.structuredJson')}</NativeSelectOption>
                </NativeSelect>
              </Field>
            )}
            {'executor' in task && task.executor.kind == 'connector' && (
              <>
                <Field>
                  <FieldLabel>{t('inspector.task.connectorAction')}</FieldLabel>
                  <FieldDescription className="reference-value">{connectorAction?.name ?? task.executor.action}</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel>{t('inspector.task.inputPorts')}</FieldLabel>
                  <FieldDescription className="reference-value">
                    {task.inputs.flatMap((port) => ('handle' in port ? [port.handle] : [])).join(', ') || t('common.none')}
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel>{t('inspector.task.outputPorts')}</FieldLabel>
                  <FieldDescription className="reference-value">
                    {task.outputs.flatMap((port) => ('handle' in port ? [port.handle] : [])).join(', ') || t('common.none')}
                  </FieldDescription>
                </Field>
              </>
            )}
          </FieldGroup>
          <div className="form-actions">
            <Button disabled={disabled || name.trim() == ''} size="sm" type="submit" variant="secondary">
              {t('inspector.task.save')}
            </Button>
          </div>
        </form>
      </details>
    </>
  )
  return (
    <>
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
          fieldIdPrefix={fieldIdPrefix}
          loading={connectorLoading}
          taskId={taskId}
        />
      )}
      {codeEditor == null ? (
        settingsPanel
      ) : (
        <Tabs className="inspector-task-tabs gap-0" onValueChange={(value) => value != null && onSectionChange(value as 'code' | 'settings')} value={section}>
          <TabsList aria-label={t('inspector.title')} className="w-full shrink-0 justify-start px-3 pt-1" variant="line">
            <TabsTrigger value="code">{t('inspector.task.javascriptModule')}</TabsTrigger>
            <TabsTrigger value="settings">{t('inspector.node.title')}</TabsTrigger>
          </TabsList>
          <TabsContent className="inspector-task-tab-panel code-tab" keepMounted value="code">
            {codeEditor}
          </TabsContent>
          <TabsContent className="inspector-task-tab-panel settings-tab" value="settings">
            {settingsPanel}
          </TabsContent>
        </Tabs>
      )}
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
          <Input disabled={disabled} id={`${subflowId}-name`} onChange={(event) => setName(event.target.value)} value={name} />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${subflowId}-inputs`}>{t('inspector.subflow.inputPorts')}</FieldLabel>
          <Textarea
            disabled={disabled}
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
            disabled={disabled}
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

function TriggerDefinition({
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
}): ReactElement {
  const t = useTranslate()
  const trigger = selection.trigger
  const [name, setName] = useState(trigger.name)
  const [description, setDescription] = useState(trigger.description ?? '')
  const providerTrigger = trigger.kind == 'poll' || trigger.kind == 'integration' ? trigger : undefined
  const fieldIdPrefix = `trigger-${selection.id}`

  useEffect(() => {
    setName(trigger.name)
    setDescription(trigger.description ?? '')
  }, [trigger])

  const connectionSection =
    providerTrigger == null ? null : (
      <section className={`inspector-section connection-state ${connection?.status == 'active' ? '' : 'required'}`} data-inspector-section="account">
        <h3>
          <Icon name="connection" size={15} /> {t('inspector.account.title')}
        </h3>
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
          <>
            <p>{t('inspector.account.connectBeforeRun', { service: providerTrigger.definition.provider })}</p>
            <Button disabled={disabled} onClick={() => void triggers.connect(providerTrigger.definition.provider)} size="sm" type="button">
              {t('inspector.account.connectService', { service: providerTrigger.definition.provider })}
            </Button>
          </>
        ) : (
          <>
            <Field className="connection-field">
              <FieldLabel htmlFor={`${fieldIdPrefix}-connection`}>{t('inspector.account.connection')}</FieldLabel>
              <NativeSelect
                disabled={disabled}
                id={`${fieldIdPrefix}-connection`}
                onChange={(event) => void triggers.setConnection(selection.id, event.target.value)}
                value={connection?.connectionId ?? ''}
              >
                {connection == null && (
                  <NativeSelectOption disabled value="">
                    {t('inspector.account.chooseAccount')}
                  </NativeSelectOption>
                )}
                {activeConnections!.map((candidate) => (
                  <NativeSelectOption key={candidate.connectionId} value={candidate.connectionId}>
                    {candidate.displayName}
                    {candidate.isDefault ? ` (${t('inspector.account.teamDefault')})` : ''}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Button disabled={disabled} onClick={() => void triggers.connect(providerTrigger.definition.provider)} size="sm" type="button" variant="secondary">
              <Icon data-icon="inline-start" name="plus" /> {t('inspector.account.addConnection')}
            </Button>
          </>
        )}
      </section>
    )

  return (
    <>
      {connectionSection}
      <form
        className="inspector-section inspector-form"
        data-inspector-section="trigger"
        onSubmit={(event) => {
          event.preventDefault()
          const common = { ...(description.trim() == '' ? {} : { description: description.trim() }), name: name.trim() }
          let settings: TriggerSettings
          switch (trigger.kind) {
            case 'webhook':
              settings = { ...common, inputs: trigger.inputsDef, kind: trigger.kind, options: trigger.options ?? {} }
              break
            case 'cron': {
              settings = {
                ...common,
                kind: trigger.kind,
                schedule: trigger.cronTimes,
              }
              break
            }
            case 'poll': {
              settings = {
                ...common,
                config: trigger.config,
                kind: trigger.kind,
                schedule: trigger.pollTimes,
              }
              break
            }
            case 'integration':
              settings = { ...common, config: trigger.config, kind: trigger.kind }
              break
          }
          void triggers.saveSettings(selection.id, settings)
        }}
      >
        <h3>{t('inspector.trigger.title')}</h3>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${fieldIdPrefix}-name`}>{t('common.name')}</FieldLabel>
            <Input disabled={disabled} id={`${fieldIdPrefix}-name`} onChange={(event) => setName(event.target.value)} value={name} />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${fieldIdPrefix}-description`}>{t('inspector.trigger.description')}</FieldLabel>
            <Input disabled={disabled} id={`${fieldIdPrefix}-description`} onChange={(event) => setDescription(event.target.value)} value={description} />
          </Field>
        </FieldGroup>
        <div className="form-actions">
          <Button disabled={disabled || name.trim() == ''} size="sm" type="submit" variant="secondary">
            {t('inspector.trigger.save')}
          </Button>
        </div>
      </form>
    </>
  )
}

interface Props {
  readonly connectorAction?: ConnectorAction
  readonly connectorActionError?: string
  readonly connectorAuthorizationPending: boolean
  readonly connectorConnection?: ConnectorConnection
  readonly connectorConnectionError?: string
  readonly activeConnectorConnections?: readonly ConnectorConnection[]
  readonly connectors: ConnectorStore
  readonly connectorLoading: boolean
  readonly diagnostics: readonly Diagnostic[]
  readonly disabled: boolean
  readonly focus?: DiagnosticFocus
  readonly onChooseWaitNotification: (button: HTMLButtonElement) => void
  readonly revision: RevisionView
  readonly selection: ResolvedSelection | undefined
  readonly store: WorkspaceStore
  readonly theme: WorkbenchTheme
  readonly target: DesignerTarget
  readonly triggerActiveConnections?: readonly ConnectorConnection[]
  readonly triggerAuthorizationPending: boolean
  readonly triggerConnection?: ConnectorConnection
  readonly triggerConnectionError?: string
  readonly triggerConnectionLoading: boolean
  readonly triggers: TriggerStore
}

export function NodeInspector({
  connectorAction,
  connectorActionError,
  connectorAuthorizationPending,
  connectorConnection,
  connectorConnectionError,
  activeConnectorConnections,
  connectors,
  connectorLoading,
  diagnostics,
  disabled,
  focus,
  onChooseWaitNotification,
  revision,
  selection,
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
  const locatedRequest = useRef<number>()
  const [taskSection, setTaskSection] = useState<'code' | 'settings'>(() => taskInspectorSection(focus?.section))

  useEffect(() => {
    setTaskSection(taskInspectorSection(focus?.section))
  }, [focus?.requestId, focus?.section, selection?.id])

  useEffect(() => {
    if (focus == null) return
    if (locatedRequest.current == focus.requestId) return
    if (selection?.kind == 'task' && !taskDiagnosticReady(focus.section, taskSection)) return
    const section = content.current?.querySelector<HTMLElement>(`[data-inspector-section="${focus.section}"]`)
    if (section == null) return
    locatedRequest.current = focus.requestId
    if (section instanceof HTMLDetailsElement) section.open = true
    section.scrollIntoView({ block: 'nearest' })
    section.classList.remove('diagnostic-located')
    void section.offsetWidth
    section.classList.add('diagnostic-located')
    const timer = globalThis.setTimeout(() => section.classList.remove('diagnostic-located'), 1_200)
    return () => globalThis.clearTimeout(timer)
  }, [focus, selection?.id, selection?.kind, taskSection])

  return (
    <div className="inspector-content" ref={content}>
      <Diagnostics diagnostics={diagnostics} />
      {selection == null ? (
        target.kind == 'subflow' ? (
          <SubflowDefinition definition={revision.subflow(target.id)!} disabled={disabled} store={store} subflowId={target.id} />
        ) : (
          <div className="inspector-empty">{t('inspector.selectNode')}</div>
        )
      ) : (
        <>
          {selection.kind == 'trigger' ? (
            <TriggerDefinition
              activeConnections={triggerActiveConnections}
              authorizationPending={triggerAuthorizationPending}
              connection={triggerConnection}
              connectionError={triggerConnectionError}
              connectionLoading={triggerConnectionLoading}
              disabled={disabled}
              selection={selection}
              triggers={triggers}
            />
          ) : selection.kind == 'task' ? (
            <TaskDefinition
              connectorAction={connectorAction}
              connectorActionError={connectorActionError}
              connectorAuthorizationPending={connectorAuthorizationPending}
              connectorConnection={connectorConnection}
              connectorConnectionError={connectorConnectionError}
              activeConnectorConnections={activeConnectorConnections}
              connectors={connectors}
              connectorLoading={connectorLoading}
              disabled={disabled}
              focus={focus}
              onSectionChange={setTaskSection}
              section={taskSection}
              selection={selection}
              store={store}
              theme={theme}
            >
              <GeneralSettings disabled={disabled} node={selection.node} nodeId={selection.id} store={store} />
            </TaskDefinition>
          ) : selection.kind == 'wait' ? (
            <WaitDefinition
              activeConnectorConnections={activeConnectorConnections}
              connectorAction={connectorAction}
              connectorActionError={connectorActionError}
              connectorAuthorizationPending={connectorAuthorizationPending}
              connectorConnection={connectorConnection}
              connectorConnectionError={connectorConnectionError}
              connectorLoading={connectorLoading}
              connectors={connectors}
              disabled={disabled}
              onChooseNotification={onChooseWaitNotification}
              revision={revision}
              selection={selection}
              store={store}
              theme={theme}
            />
          ) : (
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
  )
}
