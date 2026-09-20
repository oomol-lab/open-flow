import type { TriggerConfigOption } from '../../../../control/common/api.ts'
import type { InputValues } from '../../../../flow/common/change.ts'
import type { Group, InputPort } from '../api.ts'
import type { WorkspaceStore } from '../stores/workspaceStore.ts'

import { useEffect, useId, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { selectionMenuContentClass, selectionMenuItemClass } from '../../../../form/browser/selectionMenuStyles.ts'
import { triggerConfigValues } from '../../../../trigger/common/config.ts'
import { Button } from '../../../../ui/browser/button.tsx'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuTrigger } from '../../../../ui/browser/dropdown-menu.tsx'
import { Select, SelectChevron, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../../ui/browser/select.tsx'
import { TriggerConfigEditor } from './triggerConfigEditor.tsx'

type OptionsState = {
  readonly failed: boolean
  readonly key: string
  readonly loading: boolean
  readonly options?: readonly TriggerConfigOption[]
}

function useOptions(store: WorkspaceStore, nodeId: string, field: string, scope: string, enabled: boolean) {
  const [attempt, setAttempt] = useState(0)
  const key = JSON.stringify([nodeId, field, scope])
  const [state, setState] = useState<OptionsState>()
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    setState((current) => ({
      failed: false,
      key,
      loading: true,
      options: current?.key == key ? current.options : undefined,
    }))
    void store.loadTriggerConfigOptions(nodeId, field, controller.signal).then(
      (options) => {
        if (!controller.signal.aborted) setState({ failed: false, key, loading: false, options })
      },
      () => {
        if (!controller.signal.aborted)
          setState((current) => ({
            failed: true,
            key,
            loading: false,
            options: current?.key == key ? current.options : undefined,
          }))
      },
    )
    return () => controller.abort()
  }, [store, nodeId, field, scope, key, enabled, attempt])
  const current = enabled && state?.key == key ? state : undefined
  return {
    failed: current?.failed ?? false,
    loading: enabled && (current?.loading ?? true),
    options: current?.options,
    refresh: () => setAttempt((value) => value + 1),
  }
}

const retryTeamValue = '__open_flow_retry_linear_teams__'

export function TeamSelect({
  disabled,
  missing,
  options,
  value,
  onChange,
}: {
  readonly disabled: boolean
  readonly missing: boolean
  readonly options: ReturnType<typeof useOptions>
  readonly value?: string
  readonly onChange: (value: string) => void
}) {
  const t = useTranslate()
  const selectedKnown = value == null || options.options?.some((item) => item.value == value)
  const items = [
    ...(options.options ?? []).map((item) => ({ label: item.label, value: item.value })),
    ...(!selectedKnown && value != null ? [{ label: missing ? t('linearTrigger.unavailableTeam', { id: value }) : value, value }] : []),
    ...(options.failed ? [{ label: t('linearTrigger.retry'), value: retryTeamValue }] : []),
  ]
  return (
    <Select
      value={value ?? null}
      disabled={disabled}
      items={items}
      onOpenChange={(open) => {
        if (open) options.refresh()
      }}
      onValueChange={(next) => {
        if (next == retryTeamValue) options.refresh()
        else if (typeof next == 'string') onChange(next)
      }}
    >
      <SelectTrigger
        aria-description={missing ? t('linearTrigger.missingTeam') : undefined}
        aria-invalid={missing || undefined}
        aria-label={t('linearTrigger.team')}
        className="w-full"
        data-field-control
        data-field-prompt={missing || undefined}
        size="field"
        title={missing ? t('linearTrigger.missingTeam') : undefined}
      >
        <SelectValue placeholder={t('linearTrigger.selectTeam')} />
      </SelectTrigger>
      <SelectContent className={selectionMenuContentClass}>
        {options.loading && <span className={`block px-2 text-muted-foreground ${selectionMenuItemClass}`}>{t('linearTrigger.loading')}</span>}
        {options.options?.map((item) => (
          <SelectItem className={selectionMenuItemClass} key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
        {missing && value != null && (
          <SelectItem className={`${selectionMenuItemClass} text-destructive`} disabled value={value}>
            {t('linearTrigger.unavailableTeam', { id: value })}
          </SelectItem>
        )}
        {!options.loading && !options.failed && options.options?.length == 0 && (
          <span className={`block px-2 text-muted-foreground ${selectionMenuItemClass}`}>{t('linearTrigger.noTeams')}</span>
        )}
        {options.failed && (
          <>
            <span className={`block px-2 text-destructive ${selectionMenuItemClass}`}>{t('linearTrigger.loadFailed')}</span>
            <SelectItem className={selectionMenuItemClass} value={retryTeamValue}>
              {t('linearTrigger.retry')}
            </SelectItem>
          </>
        )}
      </SelectContent>
    </Select>
  )
}

export function StatusSelect({
  disabled,
  missing,
  options,
  selected,
  teamSelected,
  onChange,
}: {
  readonly disabled: boolean
  readonly missing: readonly string[]
  readonly options: ReturnType<typeof useOptions>
  readonly selected: readonly string[]
  readonly teamSelected: boolean
  readonly onChange: (value: readonly string[]) => void
}) {
  const t = useTranslate()
  const descriptionId = useId()
  const errorId = useId()
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const choices = [...(options.options ?? []), ...missing.map((value) => ({ label: t('linearTrigger.unavailableStatus', { id: value }), value }))]
  const selectedLabel = selected.length == 1 ? choices.find((item) => item.value == selected[0])?.label : undefined
  const summary = !teamSelected
    ? t('linearTrigger.selectTeamFirst')
    : selected.length == 0
      ? t('linearTrigger.allStatuses')
      : (selectedLabel ?? t('linearTrigger.selectedCount', { count: selected.length }))
  return (
    <div className="min-w-0" ref={setContainer}>
      <span className="sr-only" id={descriptionId}>
        {t('linearTrigger.statusHint')}
      </span>
      {missing.length > 0 && (
        <span className="sr-only" id={errorId}>
          {t('linearTrigger.missingStatuses')}
        </span>
      )}
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) options.refresh()
        }}
      >
        <DropdownMenuTrigger
          render={
            <Button
              aria-describedby={`${descriptionId}${missing.length > 0 ? ` ${errorId}` : ''}`}
              aria-invalid={missing.length > 0 || undefined}
              aria-label={t('linearTrigger.statuses')}
              className="w-full min-w-0 justify-between"
              data-field-control
              data-field-prompt={missing.length > 0 || undefined}
              disabled={disabled}
              size="field"
              title={missing.length > 0 ? t('linearTrigger.missingStatuses') : t('linearTrigger.statusHint')}
              type="button"
              variant="field"
            />
          }
        >
          <span className="min-w-0 truncate">{summary}</span>
          <SelectChevron />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          aria-label={t('linearTrigger.statuses')}
          className={`w-(--anchor-width) min-w-48 max-w-[calc(100vw-24px)] gap-1 ${selectionMenuContentClass}`}
          container={container}
        >
          <div className="flex flex-col">
            {options.loading && <span className={`px-2 text-muted-foreground ${selectionMenuItemClass}`}>{t('linearTrigger.loading')}</span>}
            {choices.length > 0 && (
              <DropdownMenuGroup aria-label={t('linearTrigger.statuses')} className="max-h-[min(60vh,360px)] overflow-y-auto">
                {choices.map((item) => {
                  const checked = selected.includes(item.value)
                  const unavailable = missing.includes(item.value)
                  return (
                    <DropdownMenuCheckboxItem
                      checked={checked}
                      className={`${selectionMenuItemClass} ${unavailable ? 'text-destructive' : ''}`}
                      key={item.value}
                      onCheckedChange={(next) => onChange(next ? [...selected, item.value] : selected.filter((value) => value != item.value))}
                    >
                      {'color' in item && item.color != null && (
                        <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                      )}
                      <span className="min-w-0 flex-1 break-words">{item.label}</span>
                    </DropdownMenuCheckboxItem>
                  )
                })}
              </DropdownMenuGroup>
            )}
            {!options.loading && !options.failed && choices.length == 0 && (
              <span className={`px-2 text-muted-foreground ${selectionMenuItemClass}`}>{t('linearTrigger.noStatuses')}</span>
            )}
            {options.failed && (
              <>
                <span className={`px-2 text-destructive ${selectionMenuItemClass}`}>{t('linearTrigger.loadFailed')}</span>
                <Button
                  className={`w-full justify-start px-2 ${selectionMenuItemClass}`}
                  onClick={options.refresh}
                  onPointerMove={(event) => {
                    if (event.pointerType === 'mouse') event.currentTarget.focus({ preventScroll: true })
                  }}
                  size="field"
                  type="button"
                  variant="ghost"
                >
                  {t('linearTrigger.retry')}
                </Button>
              </>
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function LinearTriggerConfig({
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
  const teamId = typeof config.teamId == 'string' ? config.teamId : undefined
  const selected = Array.isArray(config.stateIds) ? config.stateIds.filter((id): id is string => typeof id == 'string') : []
  const scope = JSON.stringify([store.$.flowId.value, connectionId])
  const teams = useOptions(store, nodeId, 'teamId', scope, connectionId != null)
  const states = useOptions(store, nodeId, 'stateIds', JSON.stringify([scope, teamId]), connectionId != null && teamId != null)
  const missingTeam = teamId != null && teams.options != null && !teams.options.some((item) => item.value == teamId)
  const missingStates = states.options == null ? [] : selected.filter((id) => !states.options!.some((item) => item.value == id))
  return (
    <TriggerConfigEditor
      onReset={() => store.resetTriggerConfig(nodeId)}
      onResetValue={(name) => void store.resetTriggerConfig(nodeId, [name])}
      inputs={inputs}
      config={assignments}
      disabled={disabled}
      onChange={(name, value) => void store.saveTriggerConfig(nodeId, name, value)}
      renderEditor={(input) =>
        input.handle === 'teamId' ? (
          <TeamSelect
            disabled={disabled || connectionId == null}
            missing={missingTeam}
            onChange={(value) => void store.saveTriggerConfig(nodeId, 'teamId', value)}
            options={teams}
            value={teamId}
          />
        ) : input.handle === 'stateIds' ? (
          <StatusSelect
            disabled={disabled || connectionId == null || teamId == null || missingTeam}
            missing={missingStates}
            onChange={(value) => void store.saveTriggerConfig(nodeId, 'stateIds', value)}
            options={states}
            selected={selected}
            teamSelected={teamId != null}
          />
        ) : undefined
      }
    />
  )
}
