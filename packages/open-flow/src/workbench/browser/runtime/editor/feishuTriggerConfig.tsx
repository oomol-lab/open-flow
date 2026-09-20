import type { EventSource } from '../../../../control/common/api.ts'
import type { InputValues } from '../../../../flow/common/change.ts'
import type { Group, InputPort } from '../api.ts'
import type { WorkspaceStore } from '../stores/workspaceStore.ts'

import { useEffect, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { fieldSelectTriggerClass } from '../../../../form/browser/fieldSelect.tsx'
import { selectionMenuContentClass, selectionMenuItemClass } from '../../../../form/browser/selectionMenuStyles.ts'
import { triggerConfigValues } from '../../../../trigger/common/config.ts'
import { feishuResourceKind, supportsFeishuChatFilter } from '../../../../trigger/providers/feishu/config.ts'
import { Button } from '../../../../ui/browser/button.tsx'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '../../../../ui/browser/select.tsx'
import { CreateEventSourceDialog } from '../createEventSourceDialog.tsx'
import { FeishuEventPicker } from '../feishuEventPicker.tsx'
import { FeishuEventFilters } from './feishuEventFilters.tsx'
import { TriggerConfigEditor } from './triggerConfigEditor.tsx'

function EventSourceSelect({
  label,
  value,
  options,
  disabled,
  onChange,
  onOpen,
}: {
  readonly label: string
  readonly value: string
  readonly options: readonly { readonly value: string; readonly label: string }[]
  readonly disabled: boolean
  readonly onChange: (value: string) => void
  readonly onOpen: () => void
}) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const selected = options.some((option) => option.value == value) ? value : null
  return (
    <div ref={setContainer} className="min-w-0">
      <Select
        value={selected}
        items={options}
        disabled={disabled}
        onOpenChange={(open) => {
          if (open) onOpen()
        }}
        onValueChange={(next) => {
          if (typeof next == 'string') onChange(next)
        }}
      >
        <SelectTrigger size="field" className={fieldSelectTriggerClass} aria-label={label}>
          <SelectValue placeholder={label} />
        </SelectTrigger>
        <SelectContent
          container={container}
          align="start"
          alignItemWithTrigger={false}
          className={`${selectionMenuContentClass} w-max min-w-[max(9rem,var(--anchor-width))] max-w-(--available-width)`}
        >
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value} className={selectionMenuItemClass}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}

export function FeishuTriggerConfig({
  inputs,
  config: assignments,
  nodeId,
  connectionId,
  disabled,
  store,
}: {
  readonly inputs: readonly (InputPort | Group)[]
  readonly config: InputValues
  readonly nodeId: string
  readonly connectionId?: string
  readonly disabled: boolean
  readonly store: WorkspaceStore
}) {
  const config = triggerConfigValues(inputs, assignments)
  const t = useTranslate()
  const [attempt, setAttempt] = useState(0)
  const sourceId = typeof config.sourceId == 'string' ? config.sourceId : ''
  const flowId = store.$.flowId.value
  const key = JSON.stringify([flowId, nodeId])
  const [state, setState] = useState<{ key: string; sources?: readonly EventSource[]; teamId?: string | null; failed?: boolean; loading?: boolean }>()
  useEffect(() => {
    const controller = new AbortController()
    setState((current) => (current?.key == key ? { ...current, failed: false, loading: true } : { key, loading: true }))
    void store.loadEventSources(controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) setState({ key, ...result, loading: false })
      },
      () => {
        if (!controller.signal.aborted)
          setState((current) => (current?.key == key ? { ...current, failed: true, loading: false } : { key, failed: true, loading: false }))
      },
    )
    return () => controller.abort()
  }, [store, key, attempt])
  const sources = state?.key == key ? state.sources : undefined
  const matchingSources = sources?.filter((source) => source.provider == 'feishu_app_bot' && source.connectionId == connectionId)
  const options = matchingSources?.map((source) => ({ value: source.sourceId, label: source.name }))
  const failed = state?.key == key && state.failed
  const loading = state?.key != key || state.loading == true
  const selectedSource = matchingSources?.find((source) => source.sourceId == sourceId)
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
      onResetValue={(name) => void store.resetTriggerConfig(nodeId, [name])}
      inputs={visibleInputs}
      config={assignments}
      disabled={disabled}
      onChange={(name, value) => void store.saveTriggerConfig(nodeId, name, value)}
      renderEditor={(input) =>
        input.handle === 'sourceId' ? (
          <div className="flex min-w-0 flex-col gap-2">
            {options == null ? (
              <div className="flex h-[30px] w-full items-center rounded-[var(--ui-control-radius,var(--ui-radius))] border border-input bg-[var(--ui-control-background,var(--ui-muted))] px-2 text-xs text-muted-foreground">
                {t('eventSources.loading')}
              </div>
            ) : options.length > 0 ? (
              <EventSourceSelect
                label={t('eventSources.source')}
                value={sourceId}
                options={options}
                disabled={disabled}
                onOpen={() => setAttempt((value) => value + 1)}
                onChange={(value) => {
                  const source = matchingSources?.find((item) => item.sourceId == value)
                  if (source != null) void store.setTriggerEventSource(nodeId, source)
                }}
              />
            ) : (
              <div className="flex h-[30px] w-full items-center overflow-hidden rounded-[var(--ui-control-radius,var(--ui-radius))] border border-input bg-[var(--ui-control-background,var(--ui-muted))]">
                <CreateEventSourceDialog
                  key={JSON.stringify([store.$.flowId.value, nodeId])}
                  className="min-w-0 flex-1"
                  trigger={
                    <Button type="button" size="field" variant="ghost" className="h-full w-full justify-start rounded-none border-0 bg-transparent px-2" />
                  }
                  client={store.eventSourceClient}
                  teamId={state?.key == key ? (state.teamId ?? null) : null}
                  existingNames={sources?.map((source) => source.name) ?? []}
                  disabled={disabled || state?.key != key || state.teamId === undefined}
                  onCreated={(source) => setState((current) => (current?.key == key ? { ...current, sources: [...(current.sources ?? []), source] } : current))}
                  onSelect={async (source) => store.$.flowId.value == flowId && (await store.setTriggerEventSource(nodeId, source))}
                />
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  className="mr-0.5 shrink-0"
                  disabled={disabled || loading}
                  title={t('eventSources.refresh')}
                  aria-label={t('eventSources.refresh')}
                  onClick={() => setAttempt((value) => value + 1)}
                >
                  <i aria-hidden="true" className={`i-lucide-light:refresh-cw ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`} />
                </Button>
              </div>
            )}
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
