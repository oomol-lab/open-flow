import type { EventSource } from '../../../../control/common/api.ts'
import type { InputValues } from '../../../../flow/common/change.ts'
import type { Group, InputPort } from '../api.ts'
import type { WorkspaceStore } from '../stores/workspaceStore.ts'

import { useEffect, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { triggerConfigValues } from '../../../../trigger/common/config.ts'
import { feishuResourceKind, supportsFeishuChatFilter } from '../../../../trigger/providers/feishu/config.ts'
import { Button } from '../../../../ui/browser/button.tsx'
import { CreateEventSourceDialog } from '../createEventSourceDialog.tsx'
import { SourceSelect } from '../eventSources.tsx'
import { FeishuEventPicker } from '../feishuEventPicker.tsx'
import { FeishuEventFilters } from './feishuEventFilters.tsx'
import { TriggerConfigEditor } from './triggerConfigEditor.tsx'

export function FeishuTriggerConfig({
  inputs,
  config: assignments,
  nodeId,
  disabled,
  store,
}: {
  readonly inputs: readonly (InputPort | Group)[]
  readonly config: InputValues
  readonly nodeId: string
  readonly disabled: boolean
  readonly store: WorkspaceStore
}) {
  const config = triggerConfigValues(inputs, assignments)
  const t = useTranslate()
  const [attempt, setAttempt] = useState(0)
  const sourceId = typeof config.sourceId == 'string' ? config.sourceId : ''
  const flowId = store.$.flowId.value
  const key = JSON.stringify([flowId, nodeId, attempt])
  const [state, setState] = useState<{ key: string; sources?: readonly EventSource[]; teamId?: string | null; failed?: boolean }>()
  useEffect(() => {
    const controller = new AbortController()
    void store.loadEventSources(controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) setState({ key, ...result })
      },
      () => {
        if (!controller.signal.aborted) setState({ key, failed: true })
      },
    )
    return () => controller.abort()
  }, [store, key])
  const sources = state?.key == key ? state.sources : undefined
  const options = sources?.filter((source) => source.provider == 'feishu_app_bot').map((source) => ({ value: source.sourceId, label: source.name }))
  const failed = state?.key == key && state.failed
  const selectedSource = sources?.find((source) => source.sourceId == sourceId)
  const eventOptions = selectedSource?.eventTypes.map((type) => ({ value: type, label: type }))
  const selectedEvents = Array.isArray(config.eventTypes) ? config.eventTypes.filter((value): value is string => typeof value == 'string') : []
  const visibleInputs = inputs.filter((input) => {
    if ('group' in input || input.handle === 'sourceId') return true
    if (!sourceId) return false
    if (input.handle === 'chatIds') return supportsFeishuChatFilter(selectedEvents) || (Array.isArray(config.chatIds) && config.chatIds.length > 0)
    if (input.handle === 'resource') return feishuResourceKind(selectedEvents) != null || config.resource != null
    return true
  })
  return (
    <TriggerConfigEditor
      onReset={() => {
        return store.resetTriggerConfig(nodeId)
      }}
      inputs={visibleInputs}
      config={assignments}
      disabled={disabled}
      onChange={(name, value) => void store.saveTriggerConfig(nodeId, name, value)}
      renderEditor={(input) =>
        input.handle === 'sourceId' ? (
          <div className="flex flex-col gap-2">
            {options?.length != 0 && (
              <SourceSelect
                label={t('eventSources.source')}
                value={sourceId}
                options={options ?? []}
                disabled={disabled || options == null}
                onChange={(value) => {
                  const source = sources?.find((item) => item.sourceId == value)
                  if (source != null) void store.setTriggerEventSource(nodeId, source)
                }}
              />
            )}
            {options?.length == 0 && <h3 className="m-0 text-sm font-medium">{t('eventSources.source')}</h3>}
            {options?.length == 0 && <p className="m-0 text-sm leading-5 text-muted-foreground">{t('eventSources.noSources')}</p>}
            {sourceId && options != null && !options.some((option) => option.value == sourceId) && (
              <p role="alert" className="text-sm text-destructive">
                {t('eventSources.notFound')}
              </p>
            )}
            {failed && (
              <p role="alert" className="text-sm text-destructive">
                {t('eventSources.loadFailed')}
              </p>
            )}
            <div className="flex items-center gap-2">
              <CreateEventSourceDialog
                key={JSON.stringify([store.$.flowId.value, nodeId])}
                client={store.eventSourceClient}
                teamId={state?.key == key ? (state.teamId ?? null) : null}
                existingNames={sources?.map((source) => source.name) ?? []}
                disabled={disabled || state?.key != key || state.teamId === undefined}
                onCreated={(source) => setState((current) => (current?.key == key ? { ...current, sources: [...(current.sources ?? []), source] } : current))}
                onSelect={async (source) => store.$.flowId.value == flowId && (await store.setTriggerEventSource(nodeId, source))}
              />
              <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setAttempt(attempt + 1)}>
                {t('eventSources.refresh')}
              </Button>
            </div>
          </div>
        ) : input.handle === 'eventTypes' ? (
          <div className="flex flex-col gap-2">
            <FeishuEventPicker
              value={selectedEvents}
              allowedEvents={(eventOptions ?? []).map((option) => option.value)}
              disabled={disabled || eventOptions == null}
              onChange={(value) => void store.saveTriggerConfig(nodeId, 'eventTypes', value)}
            />
            <p className="m-0 text-xs text-muted-foreground">{t('eventSources.sourceEventsHint')}</p>
          </div>
        ) : input.handle === 'chatIds' || input.handle === 'resource' ? (
          <FeishuEventFilters
            field={input.handle}
            config={config}
            events={selectedEvents}
            managed={selectedSource?.manageSubscriptions ?? false}
            disabled={disabled || selectedSource == null}
            onChange={(name, value) => void store.saveTriggerConfig(nodeId, name, value)}
          />
        ) : undefined
      }
    />
  )
}
