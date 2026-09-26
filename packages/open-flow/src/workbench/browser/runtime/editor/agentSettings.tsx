import type { ReactElement, ReactNode, SetStateAction } from 'react'
import type { InputPort, ManagedTaskDefinition, ManagedTaskExecutor } from '../../../../flow/common/change.ts'
import type { ConnectorConnection } from '../api.ts'
import type { ConnectorActionView } from '../connectionCatalog.ts'
import type { WorkbenchTheme } from '../contract.ts'
import type { ConnectorStore } from '../stores/connectorStore.ts'
import type { WorkspaceStore } from '../stores/workspaceStore.ts'

import { dequal } from 'dequal/lite'
import { createContext, useContext, useEffect, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { currentFlowModelVersion } from '../../../../flow/common/change.ts'
import { decodeRevisionContent } from '../../../../flow/common/changeSchema.ts'
import { ValueEditorFeedback } from '../../../../form/browser/fieldControl.tsx'
import { Button } from '../../../../ui/browser/button.tsx'
import { Field, FieldLabel, FieldDescription } from '../../../../ui/browser/field.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { Switch } from '../../../../ui/browser/switch.tsx'
import { AgentChanges, agentFixedValuesValid } from './agentChanges.ts'
import { AgentTools } from './agentTools.tsx'
import { PromptEditor } from './promptEditor.tsx'

const AgentSettingsContext = createContext<{ prompt: ReactNode; advanced: ReactNode } | null>(null)

export function AgentPrompt() {
  return useContext(AgentSettingsContext)?.prompt
}
export function AgentAdvancedSettings() {
  return useContext(AgentSettingsContext)?.advanced
}

export function AgentSettingsProvider({
  children,
  task,
  nodeId,
  store,
  connectors,
  prepareAction,
  disabled,
  theme,
}: {
  readonly children: ReactNode
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
  const save = async (): Promise<boolean> => {
    const value = changes.value
    const notification = value.kind === 'agent' && value.notification != null ? store.$.revision.value?.task(value.notification.taskId) : undefined
    const notificationInputs = notification?.inputs.filter((port): port is InputPort => 'handle' in port) ?? []
    if (value.kind == 'agent' && (!value.model.trim() || !Number.isSafeInteger(value.maxRounds) || value.maxRounds < 1 || value.maxRounds > 100)) return false
    if (!agentFixedValuesValid(value, notificationInputs)) {
      setSaveError(t('agent.invalidValues'))
      return false
    }
    setSaveError(undefined)
    try {
      const saved = await changes.save()
      if (!saved) setSaveError(t('agent.saveFailed'))
      return saved
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause))
      return false
    }
  }

  const setConfig = (value: SetStateAction<ManagedTaskExecutor>, commit = true) => {
    changes.value = typeof value == 'function' ? value(changes.value) : value
    renderConfig(changes.value)
    if (commit) save()
  }
  const revision = useVal(store.$.revision)
  if (config.kind != 'agent' || revision == null) return <>{children}</>
  const inputs = task.inputs.filter((port): port is InputPort => 'handle' in port)
  const promptSection = (
    <section className="inspector-section inspector-titled-section code-section" data-inspector-section="task">
      <h3 className="inspector-section-title">
        <span className="min-w-0 flex-1">{t('agent.prompt')}</span>
        <AgentTools
          config={config}
          disabled={disabled}
          inputs={inputs}
          connectors={connectors}
          prepareAction={prepareAction}
          onSave={async (tools) => {
            const previous = changes.value.kind == 'agent' ? changes.value.tools : []
            setConfig((before) => (before.kind == 'agent' ? { ...before, tools } : before), false)
            const saved = await save()
            if (!saved) setConfig((before) => (before.kind == 'agent' && before.tools === tools ? { ...before, tools: previous } : before), false)
            return saved
          }}
        />
      </h3>
      <div className="inspector-section-content" data-inset>
        <ValueEditorFeedback error={saveError}>
          {(errorId) => (
            <PromptEditor
              ariaDescribedBy={errorId}
              invalid={saveError != null}
              value={config.prompt}
              inputs={inputs.map((port) => port.handle)}
              disabled={disabled}
              theme={theme}
              onChange={(prompt) => setConfig((before) => (before.kind == 'agent' ? { ...before, prompt } : before), false)}
              onSave={() => void save()}
            />
          )}
        </ValueEditorFeedback>
        {saveError != null && (
          <div className="form-actions code-actions">
            <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => void save()}>
              {t('inspector.task.retrySave')}
            </Button>
          </div>
        )}
      </div>
    </section>
  )
  const modelError = config.model.trim() ? undefined : t('agent.modelRequired')
  const roundsError = Number.isSafeInteger(config.maxRounds) && config.maxRounds >= 1 && config.maxRounds <= 100 ? undefined : t('agent.roundsInvalid')
  const advanced = (
    <fieldset disabled={disabled} className="grid gap-4 border-0 p-0 m-0">
      <Field>
        <FieldLabel htmlFor={`${nodeId}-model`}>{t('agent.model')}</FieldLabel>
        <ValueEditorFeedback error={modelError}>
          {(errorId) => (
            <Input
              aria-describedby={errorId}
              aria-invalid={modelError != null}
              id={`${nodeId}-model`}
              value={config.model}
              onBlur={() => void save()}
              onChange={(event) => setConfig({ ...config, model: event.target.value }, false)}
            />
          )}
        </ValueEditorFeedback>
      </Field>
      <Field orientation="horizontal">
        <div className="agent-code-copy">
          <FieldLabel htmlFor={`${nodeId}-code`}>{t('agent.code')}</FieldLabel>
          <FieldDescription id={`${nodeId}-code-description`}>{t('agent.codeHint')}</FieldDescription>
        </div>
        <Switch
          disabled={disabled}
          id={`${nodeId}-code`}
          aria-describedby={`${nodeId}-code-description`}
          size="sm"
          checked={config.code == true}
          onCheckedChange={(code) => setConfig({ ...config, code })}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${nodeId}-rounds`}>{t('agent.rounds')}</FieldLabel>
        <ValueEditorFeedback error={roundsError}>
          {(errorId) => (
            <Input
              aria-describedby={errorId}
              aria-invalid={roundsError != null}
              id={`${nodeId}-rounds`}
              type="number"
              min={1}
              max={100}
              step={1}
              value={config.maxRounds}
              onBlur={() => void save()}
              onChange={(event) => setConfig({ ...config, maxRounds: Number(event.target.value) }, false)}
            />
          )}
        </ValueEditorFeedback>
        <FieldDescription>{t('agent.roundsHint')}</FieldDescription>
      </Field>
    </fieldset>
  )
  return <AgentSettingsContext.Provider value={{ prompt: promptSection, advanced }}>{children}</AgentSettingsContext.Provider>
}
