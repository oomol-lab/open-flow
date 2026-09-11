import type { JsonValue, TriggerConfigOption } from '../../../../control/common/api.ts'
import type { WorkspaceStore } from '../stores/workspaceStore.ts'

import { useEffect, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { Checkbox } from '../../../../ui/browser/checkbox.tsx'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '../../../../ui/browser/field.tsx'
import { Label } from '../../../../ui/browser/label.tsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../../ui/browser/select.tsx'

function useOptions(store: WorkspaceStore, nodeId: string, field: string, scope: string, enabled: boolean) {
  const [attempt, setAttempt] = useState(0)
  const key = JSON.stringify([nodeId, field, scope, attempt, enabled])
  const [state, setState] = useState<{ key: string; options?: readonly TriggerConfigOption[]; failed?: boolean }>()
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    void store.loadTriggerConfigOptions(nodeId, field, controller.signal).then(
      (options) => {
        if (!controller.signal.aborted) setState({ key, options })
      },
      () => {
        if (!controller.signal.aborted) setState({ key, failed: true })
      },
    )
    return () => controller.abort()
  }, [store, nodeId, field, key, enabled])
  return { ...(state?.key == key ? state : {}), loading: enabled && state?.key != key, retry: () => setAttempt((value) => value + 1) }
}

export function LinearTriggerConfig({
  config,
  nodeId,
  connectionId,
  disabled,
  store,
}: {
  readonly config: Readonly<Record<string, JsonValue>>
  readonly nodeId: string
  readonly connectionId?: string
  readonly disabled: boolean
  readonly store: WorkspaceStore
}) {
  const t = useTranslate()
  const teamId = typeof config.teamId == 'string' ? config.teamId : undefined
  const selected = Array.isArray(config.stateIds) ? config.stateIds.filter((id): id is string => typeof id == 'string') : []
  const scope = JSON.stringify([store.$.flowId.value, connectionId])
  const teams = useOptions(store, nodeId, 'teamId', scope, connectionId != null)
  const states = useOptions(store, nodeId, 'stateIds', JSON.stringify([scope, teamId]), connectionId != null && teamId != null)
  const missingTeam = teamId != null && teams.options != null && !teams.options.some((item) => item.value == teamId)
  const missingStates = states.options == null ? [] : selected.filter((id) => !states.options!.some((item) => item.value == id))
  return (
    <section className="inspector-section" data-inspector-section="trigger">
      <h3>{t('triggerConfig.configuration')}</h3>
      <FieldGroup>
        <Field data-invalid={missingTeam || undefined}>
          <FieldLabel>{t('linearTrigger.team')}</FieldLabel>
          <Select
            value={teamId ?? null}
            disabled={disabled || teams.options == null || teams.options.length == 0}
            onValueChange={(value) => {
              if (typeof value == 'string') void store.saveTriggerConfig(nodeId, 'teamId', value)
            }}
            items={teams.options?.map((item) => ({ value: item.value, label: item.label }))}
          >
            <SelectTrigger className="w-full" aria-label={t('linearTrigger.team')}>
              <SelectValue placeholder={t('linearTrigger.selectTeam')} />
            </SelectTrigger>
            <SelectContent>
              {teams.options?.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {connectionId == null && <FieldDescription>{t('linearTrigger.connectFirst')}</FieldDescription>}
          {teams.loading && <FieldDescription>{t('linearTrigger.loading')}</FieldDescription>}
          {teams.options?.length == 0 && <FieldDescription>{t('linearTrigger.noTeams')}</FieldDescription>}
          {missingTeam && <FieldError>{t('linearTrigger.missingTeam')}</FieldError>}
          {teams.failed && (
            <FieldError>
              {t('linearTrigger.loadFailed')}{' '}
              <Button size="sm" variant="ghost" onClick={teams.retry}>
                {t('linearTrigger.retry')}
              </Button>
            </FieldError>
          )}
        </Field>
        <Field data-invalid={missingStates.length > 0 || undefined}>
          <FieldLabel>{t('linearTrigger.statuses')}</FieldLabel>
          <FieldDescription>{teamId == null ? t('linearTrigger.selectTeamFirst') : t('linearTrigger.statusHint')}</FieldDescription>
          {teamId != null && (
            <FieldDescription>
              {selected.length == 0 ? t('linearTrigger.allStatuses') : t('linearTrigger.selectedCount', { count: selected.length })}
            </FieldDescription>
          )}
          {states.loading && <FieldDescription>{t('linearTrigger.loading')}</FieldDescription>}
          {states.options?.length == 0 && <FieldDescription>{t('linearTrigger.noStatuses')}</FieldDescription>}
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {[...(states.options ?? []), ...missingStates.map((value) => ({ value, label: t('linearTrigger.unavailableStatus', { id: value }) }))].map(
              (item) => (
                <Label key={item.value} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={selected.includes(item.value)}
                    disabled={disabled || states.options == null || missingTeam}
                    onCheckedChange={(checked) => {
                      void store.saveTriggerConfig(nodeId, 'stateIds', checked ? [...selected, item.value] : selected.filter((id) => id != item.value))
                    }}
                  />
                  {'color' in item && <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} aria-hidden />}
                  <span>{item.label}</span>
                </Label>
              ),
            )}
          </div>
          {missingStates.length > 0 && <FieldError>{t('linearTrigger.missingStatuses')}</FieldError>}
          {states.failed && (
            <FieldError>
              {t('linearTrigger.loadFailed')}{' '}
              <Button size="sm" variant="ghost" onClick={states.retry}>
                {t('linearTrigger.retry')}
              </Button>
            </FieldError>
          )}
        </Field>
      </FieldGroup>
    </section>
  )
}
