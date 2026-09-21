import type { ReactElement, SetStateAction } from 'react'
import type { InputPort, ManagedTaskDefinition, ManagedTaskExecutor } from '../../../../flow/common/change.ts'
import type { ConnectorConnection } from '../api.ts'
import type { ConnectorActionView } from '../connectionCatalog.ts'
import type { WorkbenchTheme } from '../contract.ts'
import type { ConnectorStore } from '../stores/connectorStore.ts'
import type { WorkspaceStore } from '../stores/workspaceStore.ts'

import { dequal } from 'dequal/lite'
import { ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { currentFlowModelVersion } from '../../../../flow/common/change.ts'
import { decodeRevisionContent } from '../../../../flow/common/changeSchema.ts'
import { Button } from '../../../../ui/browser/button.tsx'
import { Field, FieldLabel, FieldError, FieldDescription } from '../../../../ui/browser/field.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { Switch } from '../../../../ui/browser/switch.tsx'
import { Textarea } from '../../../../ui/browser/textarea.tsx'
import { WorkbenchSelect } from '../shell/workbenchSelect.tsx'
import { AgentChanges, agentFixedValuesValid } from './agentChanges.ts'
import { AgentNotification } from './agentNotification.tsx'
import { AgentTools } from './agentTools.tsx'

export function AgentSettings({
  task,
  nodeId,
  store,
  connectors,
  prepareAction,
  disabled,
  theme,
}: {
  readonly task: ManagedTaskDefinition
  readonly nodeId: string
  readonly store: WorkspaceStore
  readonly connectors: ConnectorStore
  readonly prepareAction?: (
    action: ConnectorActionView,
  ) => Promise<{ readonly action: ConnectorActionView; readonly connections: readonly ConnectorConnection[] } | undefined>
  readonly disabled: boolean
  readonly theme: WorkbenchTheme
}): ReactElement | null {
  const t = useTranslate()
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null)
  const [config, renderConfig] = useState(task.executor)
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
          modelVersion: currentFlowModelVersion,
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
  const [error, setError] = useState<string>()
  const revision = useVal(store.$.revision)
  if (config.kind != 'agent' || revision == null) return null
  const inputs = task.inputs.filter((port): port is InputPort => 'handle' in port)
  const validity = (key: string, valid: boolean) => {
    if (valid) invalidDrafts.current.delete(key)
    else invalidDrafts.current.add(key)
    setInvalid(new Set(invalidDrafts.current))
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
        <AgentTools
          config={config}
          setConfig={setConfig}
          disabled={disabled}
          portalRoot={portalRoot}
          inputs={inputs}
          theme={theme}
          validity={validity}
          save={save}
          nodeId={nodeId}
          connectors={connectors}
          prepareAction={prepareAction}
          setError={setError}
        />
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
            <AgentNotification
              config={config}
              setConfig={setConfig}
              disabled={disabled}
              portalRoot={portalRoot}
              inputs={inputs}
              theme={theme}
              validity={validity}
              save={save}
              revision={revision}
            />
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
