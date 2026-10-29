import type { ReactNode } from 'react'
import type { WorkflowCapability } from '../../../../flow/common/change.ts'
import type { WorkflowCandidate, WorkflowContract } from '../../../../workflow/common/workflow.ts'
import type { ToolPickerGroup } from './toolPickerList.tsx'

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { workflowToolNameIssue } from '../../../../flow/common/change.ts'
import { Button } from '../../../../ui/browser/button.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { Spinner } from '../../../../ui/browser/spinner.tsx'
import { Tooltip, TooltipTrigger, TooltipContent } from '../../../../ui/browser/tooltip.tsx'
import { workflowCandidateGroup, sameWorkflowInterface } from '../../../../workflow/common/workflow.ts'
import { errorNotice } from '../stores/workbenchNotice.ts'
import { ProviderAppIcon } from './providerAppIcon.tsx'
import { SelectedToolRow } from './selectedToolRow.tsx'
import { ToolPickerList } from './toolPickerList.tsx'
import { WorkflowCandidateStatusDot } from './workflowCandidates.tsx'
import { OpenWorkflowLink } from './workflowSection.tsx'

export interface WorkflowToolSelection<T> {
  list(signal?: AbortSignal): Promise<readonly WorkflowCandidate[]>
  load(flowId: string, signal?: AbortSignal): Promise<WorkflowContract>
  create(target: WorkflowCandidate | WorkflowContract, entries: readonly T[]): T
  refresh(entry: T, target: WorkflowContract): T
}

export function useWorkflowToolCatalog(list?: WorkflowToolSelection<unknown>['list']) {
  const t = useTranslate()
  const [choices, setChoices] = useState<readonly WorkflowCandidate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (list == null) return
    const controller = new AbortController()
    setLoading(true)
    setError(undefined)
    void list(controller.signal)
      .then(
        (items) => {
          if (!controller.signal.aborted) setChoices(items)
        },
        (cause: unknown) => {
          if (!controller.signal.aborted) setError(errorNotice(cause, t).message)
        },
      )
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [list, attempt, t])
  return { choices, loading: list != null && loading, error, retry: () => setAttempt((value) => value + 1) }
}

export function WorkflowToolPicker({
  catalog,
  selected,
  disabled,
  onToggle,
}: {
  readonly catalog: ReturnType<typeof useWorkflowToolCatalog>
  readonly selected: readonly string[]
  readonly disabled: boolean
  readonly onToggle: (target: WorkflowCandidate) => void
}) {
  const t = useTranslate()
  const [query, setQuery] = useState('')
  const { choices, loading, error, retry } = catalog
  const groups = useMemo<ToolPickerGroup<WorkflowCandidate>[]>(() => {
    const visible = choices.filter((item) => `${item.name} ${item.flowId}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    return (['published', 'missingStart', 'other'] as const).flatMap((group) => {
      const items = visible.filter((item) => workflowCandidateGroup(item) == group)
      if (items.length == 0 && group != 'published') return []
      return [
        {
          id: group,
          title: t(`workflow.groups.${group}`),
          icon: <WorkflowCandidateStatusDot group={group} />,
          empty: !items.length && !loading && !error ? t(query ? 'workflow.noMatches' : 'workflow.empty') : undefined,
          items: items.map((item) => ({
            id: item.flowId,
            value: item,
            kind: 'selection' as const,
            name: item.name,
            icon: (
              <ProviderAppIcon>
                <i aria-hidden="true" className="i-lucide-light:workflow size-4 text-muted-foreground" />
              </ProviderAppIcon>
            ),
            checked: selected.includes(item.flowId),
          })),
        },
      ]
    })
  }, [choices, query, loading, error, selected, t])
  return (
    <ToolPickerList
      groups={groups}
      query={query}
      onQueryChange={setQuery}
      searchLabel={t('workflow.search')}
      loading={loading}
      error={error}
      onRetry={retry}
      disabled={disabled}
      onChoose={onToggle}
    />
  )
}

export function SelectedWorkflowTool({
  entry,
  workflowName,
  disabled,
  load,
  onRefresh,
  onChange,
  otherNames,
  onValidChange,
  onRemove,
  children,
  portalRoot,
}: {
  readonly workflowName?: string
  readonly entry: WorkflowCapability
  readonly disabled: boolean
  readonly load?: WorkflowToolSelection<unknown>['load']
  readonly onRefresh: (contract: WorkflowContract) => void
  readonly onChange: (name: string) => void
  readonly otherNames: readonly string[]
  readonly onValidChange: (valid: boolean) => void
  readonly onRemove: () => void
  readonly children?: ReactNode
  readonly portalRoot?: HTMLElement | null
}) {
  const t = useTranslate()
  const [issue, setIssue] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [target, setTarget] = useState<WorkflowContract>()
  const interfaceKey = JSON.stringify({
    inputs: entry.inputs.map(({ handle, jsonSchema, nullable }) => ({ handle, jsonSchema, nullable })),
    outputs: entry.outputs,
  })
  const { flowId, revisionId } = entry
  useEffect(() => {
    if (load == null) return
    const controller = new AbortController()
    setBusy(true)
    void load(flowId, controller.signal)
      .then(
        (contract) => {
          if (controller.signal.aborted) return
          setTarget(contract)
          setIssue(
            !revisionId || !sameWorkflowInterface(JSON.parse(interfaceKey) as Pick<WorkflowContract, 'inputs' | 'outputs'>, contract)
              ? t('workflow.staleTitle')
              : undefined,
          )
        },
        (cause: unknown) => {
          if (!controller.signal.aborted) setIssue(errorNotice(cause, t).message)
        },
      )
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false)
      })
    return () => controller.abort()
  }, [flowId, revisionId, interfaceKey, load, attempt, t])
  const targetName = target?.name ?? workflowName ?? entry.flowId
  const removeLabel = t('actionPicker.remove', { action: targetName })
  return (
    <SelectedToolRow
      icon={
        <ProviderAppIcon>
          <i aria-hidden="true" className="i-lucide-light:workflow size-4 text-muted-foreground" />
        </ProviderAppIcon>
      }
      title={
        children == null ? (
          <WorkflowToolTitle name={entry.name} disabled={disabled} onChange={onChange} otherNames={otherNames} onValidChange={onValidChange} />
        ) : (
          entry.name
        )
      }
      subtitle={
        <>
          <span className="truncate" title={targetName}>
            {t('toolPicker.workflow')} · {targetName}
          </span>
          <OpenWorkflowLink flowId={entry.flowId} />
        </>
      }
      actions={
        children ?? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button type="button" size="icon-sm" variant="ghost" disabled={disabled} aria-label={removeLabel} onClick={onRemove}>
                  <i aria-hidden="true" className="i-lucide-light:trash-2 size-4 text-muted-foreground" />
                </Button>
              }
            />
            <TooltipContent container={portalRoot}>{removeLabel}</TooltipContent>
          </Tooltip>
        )
      }
    >
      <div className={`open-flow-property-panel flex min-w-0 items-start gap-2 rounded-md px-2 py-1.5 ${issue && !busy ? 'bg-destructive/5' : 'bg-muted/60'}`}>
        <p
          role="status"
          className={`m-0 flex min-w-0 flex-1 items-start gap-1.5 py-0.5 text-xs leading-5 ${issue && !busy ? 'text-destructive' : 'text-muted-foreground'}`}
        >
          <span aria-hidden="true" className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
            {busy ? <Spinner /> : <i className={issue ? 'i-lucide-light:circle-alert size-4' : 'i-lucide-light:circle-check size-4'} />}
          </span>
          <span className="min-w-0 break-words">{busy ? t('workflow.loading') : (issue ?? t('toolPicker.current'))}</span>
        </p>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                size="icon-xs"
                variant={issue && !busy ? 'destructive-ghost' : 'ghost'}
                className={issue && !busy ? undefined : 'text-muted-foreground'}
                aria-label={t('workflow.refresh')}
                disabled={disabled || busy || load == null}
                onClick={async () => {
                  setBusy(true)
                  try {
                    const contract = await load!(entry.flowId)
                    onRefresh(contract)
                    setAttempt((value) => value + 1)
                  } catch (cause) {
                    setIssue(errorNotice(cause, t).message)
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                <i aria-hidden="true" className="i-lucide-light:rotate-cw size-4" />
              </Button>
            }
          />
          <TooltipContent container={portalRoot}>{t('workflow.refresh')}</TooltipContent>
        </Tooltip>
      </div>
    </SelectedToolRow>
  )
}

export function availableWorkflowToolName(target: WorkflowCandidate | WorkflowContract, entries: readonly { readonly name?: string }[]): string {
  const base =
    target.name
      .replace(/[^A-Za-z0-9_-]/g, '_')
      .replace(/^[^A-Za-z]+/, '')
      .slice(0, 54) || 'workflow'
  let name = base
  let suffix = 2
  while (entries.some((entry) => entry.name == name)) name = `${base}_${suffix++}`
  return name
}

function WorkflowToolTitle({
  name,
  disabled,
  onChange,
  otherNames,
  onValidChange,
}: {
  readonly name: string
  readonly disabled: boolean
  readonly onChange: (name: string) => void
  readonly otherNames: readonly string[]
  readonly onValidChange: (valid: boolean) => void
}) {
  const t = useTranslate()
  const [edit, setEdit] = useState<{ original: string; value: string }>()
  const errorId = useId()
  const valid = workflowToolNameIssue(edit?.value ?? name, otherNames) == null
  useLayoutEffect(() => {
    onValidChange(valid)
    if (valid && edit != null && edit.value != name) onChange(edit.value)
  }, [valid, edit, name, onChange, onValidChange])
  const trigger = useRef<HTMLButtonElement>(null)
  return (
    <span className="open-flow-property-panel relative -mx-2 flex">
      <Button
        ref={trigger}
        type="button"
        variant="ghost"
        size="xs"
        className="-my-0.5 block w-full cursor-text truncate border-0 py-0.5 text-left text-[13px] leading-5 hover:bg-accent/50 focus-visible:bg-accent/50 disabled:cursor-default dark:hover:bg-accent/50"
        aria-label={t('toolPicker.alias')}
        title={name}
        disabled={disabled}
        onClick={() => setEdit({ original: name, value: name })}
      >
        {name || t('toolPicker.alias')}
      </Button>
      {edit != null && (
        <Input
          autoFocus
          controlSize="field"
          className="absolute inset-x-0 -inset-y-0.5 h-auto py-0 text-[13px] font-medium"
          aria-label={t('toolPicker.alias')}
          value={edit.value}
          aria-invalid={!valid || undefined}
          aria-describedby={valid ? undefined : errorId}
          disabled={disabled}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setEdit({ ...edit, value: event.target.value })}
          onBlur={() => {
            if (valid) setEdit(undefined)
          }}
          onKeyDown={(event) => {
            if (event.key != 'Enter' && event.key != 'Escape') return
            event.preventDefault()
            event.stopPropagation()
            if (event.key == 'Escape') {
              if (workflowToolNameIssue(edit.original, otherNames) != null) {
                setEdit({ ...edit, value: edit.original })
                return
              }
              onChange(edit.original)
            } else if (!valid) return
            setEdit(undefined)
            trigger.current?.focus()
          }}
        />
      )}
      {!valid && (
        <span id={errorId} className="sr-only">
          {t('toolPicker.aliasInvalid')}
        </span>
      )}
    </span>
  )
}
