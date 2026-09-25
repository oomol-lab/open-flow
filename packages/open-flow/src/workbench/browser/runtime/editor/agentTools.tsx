import type { AgentTool, InputPort, ManagedTaskExecutor } from '../../../../flow/common/change.ts'
import type { WorkbenchTheme } from '../contract.ts'
import type { ConnectorStore } from '../stores/connectorStore.ts'
import type { ActionDetailsProps, PrepareAction } from './actionSelectionDialog.tsx'

import { useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { Field, FieldLabel, FieldDescription } from '../../../../ui/browser/field.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { Textarea } from '../../../../ui/browser/textarea.tsx'
import { ActionSelectionDialog } from './actionSelectionDialog.tsx'
import { agentFixedValuesValid } from './agentChanges.ts'
import { AgentInputSource } from './agentInputSource.tsx'
import { agentTool } from './flowChanges.ts'

export function AgentTools({
  config,
  disabled,
  inputs,
  theme,
  connectors,
  prepareAction,
  onSave,
}: {
  readonly config: Extract<ManagedTaskExecutor, { kind: 'agent' }>
  readonly disabled: boolean
  readonly inputs: readonly InputPort[]
  readonly theme: WorkbenchTheme
  readonly connectors: ConnectorStore
  readonly prepareAction?: PrepareAction
  readonly onSave: (tools: readonly AgentTool[]) => Promise<boolean>
}) {
  const t = useTranslate()
  return (
    <ActionSelectionDialog
      title={t('agent.tools')}
      entries={config.tools}
      connectors={connectors}
      prepareAction={prepareAction}
      disabled={disabled}
      createEntry={(action) => agentTool(action, crypto.randomUUID())}
      onSave={async (tools) => {
        if (!agentFixedValuesValid({ ...config, tools })) throw new Error(t('agent.invalidValues'))
        return onSave(tools)
      }}
      renderDetails={(props) => <AgentToolDetails {...props} inputs={inputs} theme={theme} />}
    />
  )
}

function AgentToolDetails({
  entry: tool,
  onChange,
  disabled,
  portalRoot,
  onValidChange,
  inputs,
  theme,
}: ActionDetailsProps<AgentTool> & {
  readonly inputs: readonly InputPort[]
  readonly theme: WorkbenchTheme
}) {
  const t = useTranslate()
  const [parameter, setParameter] = useState<string>()
  return (
    <fieldset disabled={disabled} className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
      <FieldDescription className="m-0 text-[13px]">
        {tool.inputs.some((port) => port.source.kind != 'model')
          ? t('agent.assigned', {
              fields: tool.inputs
                .filter((port) => port.source.kind != 'model')
                .map((port) => port.handle)
                .join(', '),
            })
          : t('agent.modelParameters')}
      </FieldDescription>
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
              className="w-full justify-start text-[13px] font-normal"
              aria-expanded={open}
              aria-controls={`${id}-editor`}
              onClick={() => setParameter(open ? undefined : id)}
            >
              <i aria-hidden="true" className={open ? 'i-lucide-light:chevron-down size-3.5' : 'i-lucide-light:chevron-right size-3.5'} />
              <span id={`${id}-label`} className="min-w-0 flex-1 truncate text-left">
                {port.handle}
              </span>
              <span className="max-w-[60%] truncate text-muted-foreground" title={summary}>
                {summary}
              </span>
            </Button>
            {open && (
              <Field id={`${id}-editor`} className="agent-parameter-editor">
                <FieldDescription className="m-0 text-[13px]">{port.description}</FieldDescription>
                <AgentInputSource
                  disabled={disabled}
                  portalRoot={portalRoot}
                  model
                  labelledBy={`${tool.id}-${port.handle}-label`}
                  port={port}
                  inputs={inputs}
                  theme={theme}
                  onValidChange={(valid) => onValidChange(`${tool.id}:${port.handle}`, valid)}
                  source={port.source}
                  onCommit={() => {}}
                  onChange={(source) => onChange({ ...tool, inputs: tool.inputs.map((input) => (input.handle == port.handle ? { ...input, source } : input)) })}
                />
              </Field>
            )}
          </div>
        )
      })}
      <div className="h-px bg-border/50" />
      <Field>
        <FieldLabel className="text-[13px] font-normal">{t('agent.toolName')}</FieldLabel>
        <Input
          className="text-[13px]"
          disabled={disabled}
          aria-label={t('agent.toolName')}
          value={tool.name}
          onChange={(event) => onChange({ ...tool, name: event.target.value })}
        />
      </Field>
      <Field>
        <FieldLabel className="text-[13px] font-normal">{t('agent.description')}</FieldLabel>
        <Textarea
          className="text-[13px]"
          disabled={disabled}
          aria-label={t('agent.description')}
          value={tool.description}
          onChange={(event) => onChange({ ...tool, description: event.target.value })}
        />
      </Field>
    </fieldset>
  )
}
