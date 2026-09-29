import type { ComponentProps } from 'react'
import type { AgentTool, InputPort, ManagedTaskExecutor } from '../../../../flow/common/change.ts'
import type { ConnectorStore } from '../stores/connectorStore.ts'
import type { ActionSettingsProps, PrepareAction } from './actionSelectionDialog.tsx'

import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { Field, FieldLabel } from '../../../../ui/browser/field.tsx'
import { IconStack } from '../../../../ui/browser/icon-stack.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { PopoverDescription } from '../../../../ui/browser/popover.tsx'
import { Popover, PopoverTrigger, PopoverContent } from '../../../../ui/browser/popover.tsx'
import { actionSummary } from '../actionSummary.ts'
import { ActionSelectionDialog } from './actionSelectionDialog.tsx'
import { agentFixedValuesValid } from './agentChanges.ts'
import { AgentInputSource } from './agentInputSource.tsx'
import { agentTool } from './flowChanges.ts'
import { PurposeField } from './purposeField.tsx'

function EditableAgentTools({
  config,
  disabled,
  inputs,
  connectors,
  prepareAction,
  onSave,
}: {
  readonly config: Extract<ManagedTaskExecutor, { kind: 'agent' }>
  readonly disabled: boolean
  readonly inputs: readonly InputPort[]
  readonly connectors: ConnectorStore
  readonly prepareAction?: PrepareAction
  readonly onSave: (tools: readonly AgentTool[]) => Promise<boolean>
}) {
  const t = useTranslate()
  const catalog = useVal(connectors.$.actions)
  const summary = actionSummary(config.tools, catalog, [])
  return (
    <ActionSelectionDialog
      title={t('agent.tools')}
      triggerHint={summary.count > 0 ? t('actionPicker.selectionSummary', { actions: summary.count, providers: summary.providers.length }) : undefined}
      trigger={
        <Button type="button" variant="ghost" size="sm" className="gap-1.5 font-normal text-muted-foreground">
          {summary.count == 0 ? (
            <>
              <i aria-hidden="true" data-icon="inline-start" className="i-lucide-light:plus size-3.5" />
              {t('actionPicker.triggerLabel')}
            </>
          ) : (
            <IconStack icons={summary.providers} count={summary.count} size="sm" />
          )}
        </Button>
      }
      entries={config.tools}
      connectors={connectors}
      prepareAction={prepareAction}
      disabled={disabled}
      createEntry={(action) => agentTool(action, crypto.randomUUID())}
      onSave={async (tools) => {
        if (!agentFixedValuesValid({ ...config, tools })) throw new Error(t('agent.invalidValues'))
        return onSave(tools)
      }}
      settings={{ title: t('agent.toolSettings'), render: (props) => <AgentToolSettings {...props} inputs={inputs} /> }}
    />
  )
}

function AgentToolSettings({
  entry: tool,
  onChange,
  disabled,
  onValidChange,
  inputs,
}: Omit<ActionSettingsProps<AgentTool>, 'onChange' | 'onValidChange'> & {
  readonly onChange?: ActionSettingsProps<AgentTool>['onChange']
  readonly onValidChange?: ActionSettingsProps<AgentTool>['onValidChange']
  readonly inputs: readonly InputPort[]
}) {
  const t = useTranslate()
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
      <PopoverDescription className="m-0 text-xs leading-5">{t('agent.toolSettingsHint')}</PopoverDescription>
      <Field className="gap-1.5">
        <FieldLabel className="text-xs font-normal text-muted-foreground">{t('agent.toolName')}</FieldLabel>
        <Input
          controlSize="field"
          readOnly={disabled}
          aria-label={t('agent.toolName')}
          value={tool.name}
          onChange={(event) => onChange?.({ ...tool, name: event.target.value })}
        />
      </Field>
      <PurposeField compact readOnly={disabled} value={tool.description} onChange={(event) => onChange?.({ ...tool, description: event.target.value })} />
      {tool.inputs.length > 0 && <div className="h-px bg-border/50" />}
      {tool.inputs.map((port) => (
        <AgentInputSource
          readOnly={onChange == null}
          key={port.handle}
          disabled={disabled}
          port={port}
          inputs={inputs}
          source={port.source}
          onValidChange={(key, valid) => onValidChange?.(`${port.handle}:${key}`, valid)}
          onChange={(source) => onChange?.({ ...tool, inputs: tool.inputs.map((input) => (input.handle === port.handle ? { ...input, source } : input)) })}
        />
      ))}
    </fieldset>
  )
}

export function AgentTools(props: Omit<ComponentProps<typeof EditableAgentTools>, 'connectors'> & { readonly connectors?: ConnectorStore }) {
  const t = useTranslate()
  if (props.connectors != null) return <EditableAgentTools {...props} connectors={props.connectors} />
  if (props.config.tools.length === 0) return null
  return (
    <Popover>
      <PopoverTrigger render={<Button type="button" variant="ghost" size="sm" />}>{t('agent.tools')}</PopoverTrigger>
      <PopoverContent>
        <div className="grid max-h-96 gap-4 overflow-auto">
          {props.config.tools.map((tool) => (
            <details key={tool.id}>
              <summary>{tool.name || tool.action}</summary>
              <p className="reference-value">
                {tool.action}
                {tool.connectionId == null ? '' : ` · ${tool.connectionId}`}
              </p>
              <AgentToolSettings entry={tool} disabled inputs={props.inputs} />
            </details>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
