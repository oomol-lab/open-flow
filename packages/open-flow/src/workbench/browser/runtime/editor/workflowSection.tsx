import type { ManagedTaskDefinition } from '../../../../flow/common/change.ts'
import type { WorkflowCandidate, WorkflowContract } from '../../../../workflow/common/workflow.ts'

import { Combobox } from '@base-ui/react/combobox'
import { dequal } from 'dequal/lite'
import { useContext, useEffect, useId, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { ValueEditorFeedback } from '../../../../form/browser/fieldControl.tsx'
import { selectionMenuContentClass } from '../../../../form/browser/selectionMenuStyles.ts'
import { Button, buttonVariants } from '../../../../ui/browser/button.tsx'
import { Field, FieldLabel } from '../../../../ui/browser/field.tsx'
import { InputGroup, InputGroupAddon, InputGroupInput } from '../../../../ui/browser/input-group.tsx'
import { SelectChevron } from '../../../../ui/browser/select.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../ui/browser/tooltip.tsx'
import { workflowCandidateGroup, workflowSelectionTask } from '../../../../workflow/common/workflow.ts'
import { WorkbenchLinkContext } from '../linkContext.ts'
import { errorNotice } from '../stores/workbenchNotice.ts'
import { InspectorStatusSection } from './inspectorStatusSection.tsx'
import { WorkflowCandidateGroup, WorkflowCandidateName, workflowCandidateItemClass } from './workflowCandidates.tsx'

export function OpenWorkflowLink({ flowId }: { readonly flowId: string }) {
  const t = useTranslate()
  const hrefFor = useContext(WorkbenchLinkContext)
  if (!flowId || hrefFor == null) return null
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <a
            className={buttonVariants({ variant: 'ghost', size: 'icon-xs', className: 'text-muted-foreground' })}
            href={hrefFor({ flowId, view: 'design' })}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('workflow.open')}
          />
        }
      >
        <i aria-hidden="true" className="i-lucide-light:external-link text-sm" />
      </TooltipTrigger>
      <TooltipContent>{t('workflow.open')}</TooltipContent>
    </Tooltip>
  )
}

interface WorkflowUpdateProps {
  readonly nodeId: string
  readonly task: ManagedTaskDefinition
  readonly disabled: boolean
  readonly load: (flowId: string, signal?: AbortSignal) => Promise<WorkflowContract>
  readonly onSave: (before: ManagedTaskDefinition, next: ManagedTaskDefinition) => Promise<boolean>
  readonly onCheck: () => Promise<void>
}

export function useWorkflowActions(props: WorkflowUpdateProps | undefined) {
  const t = useTranslate()
  const [state, setState] = useState<{ nodeId: string; flowId: string; busy: boolean; error?: string; pending?: WorkflowCandidate }>()
  const request = useRef<AbortController>()
  const nodeId = props?.nodeId
  useEffect(() => () => request.current?.abort(), [nodeId])
  const current = state?.nodeId == nodeId ? state : undefined
  async function update(choice?: WorkflowCandidate) {
    if (props == null || props.disabled || props.task.executor.kind != 'workflow') return
    const candidate = choice ?? { flowId: props.task.executor.flowId, name: props.task.name, problem: null }
    if (!candidate.flowId) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    const set = (next: Omit<NonNullable<typeof state>, 'nodeId' | 'flowId'>) => {
      if (!controller.signal.aborted) setState({ nodeId: props.nodeId, flowId: candidate.flowId, ...next })
    }
    set({ busy: true, pending: choice })
    let contract: WorkflowContract | undefined
    let failure: string | undefined
    try {
      if (choice?.problem == null) {
        try {
          contract = await props.load(candidate.flowId, controller.signal)
        } catch (cause) {
          failure = errorNotice(cause, t).message
        }
      }
      if (controller.signal.aborted) return
      const next = workflowSelectionTask(candidate, contract, props.task)
      if ((choice != null || contract != null) && !dequal(next, props.task)) {
        const saved = await props.onSave(props.task, next)
        // The draft store owns save/conflict notices. Do not present them as target availability errors.
        if (!saved) failure = undefined
      } else if (!controller.signal.aborted) {
        // Changed saves already run a check; unchanged or unavailable targets need one explicitly.
        await props.onCheck()
      }
    } catch (cause) {
      failure = errorNotice(cause, t).message
    } finally {
      set({ busy: false, error: failure })
    }
  }
  return {
    busy: current?.busy ?? false,
    error: props?.task.executor.kind == 'workflow' && current?.flowId == props.task.executor.flowId ? current?.error : undefined,
    pending: current?.pending,
    select: (choice: WorkflowCandidate) => update(choice),
    recheck: () => update(),
  }
}
type WorkflowActions = ReturnType<typeof useWorkflowActions>

export function WorkflowInterfaceAlert({
  actions,
  disabled,
  message,
  stale,
  flowId,
}: {
  readonly actions: WorkflowActions
  readonly disabled: boolean
  readonly message?: string
  readonly stale: boolean
  readonly flowId: string
}) {
  const t = useTranslate()
  return (
    <InspectorStatusSection
      title={t(stale ? 'workflow.staleTitle' : 'workflow.problemTitle')}
      tone="danger"
      section="workflow-status"
      alert
      actions={
        <span className="ml-auto">
          <OpenWorkflowLink flowId={flowId} />
        </span>
      }
    >
      <div className="inspector-status-prompt">
        <p>{actions.error || message}</p>
        <Button disabled={disabled || actions.busy} size="sm" type="button" onClick={() => void actions.recheck()}>
          {t(stale ? 'workflow.refresh' : 'workflow.recheck')}
        </Button>
      </div>
    </InspectorStatusSection>
  )
}

export function WorkflowSection({
  task,
  disabled,
  actions,
  list,
}: {
  readonly task: ManagedTaskDefinition
  readonly disabled: boolean
  readonly actions: WorkflowActions
  readonly list: (signal?: AbortSignal) => Promise<readonly WorkflowCandidate[]>
}) {
  const t = useTranslate()
  const id = useId()
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string>()
  const [choices, setChoices] = useState<readonly WorkflowCandidate[]>([])
  const request = useRef<AbortController>()
  useEffect(() => () => request.current?.abort(), [])
  const target = actions.pending?.flowId ?? (task.executor.kind == 'workflow' ? task.executor.flowId : '')
  const selectedName = actions.pending?.name ?? choices.find((item) => item.flowId == target)?.name ?? task.name
  const targetError = error || (!target ? t('diagnostics.messages.workflow.target-required') : undefined)
  const visible = choices.filter((item) => `${item.name} ${item.flowId}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  async function readChoices() {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setError(undefined)
    try {
      const result = await list(controller.signal)
      if (!controller.signal.aborted) setChoices(result)
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorNotice(cause, t).message)
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }
  return (
    <Field className="inspector-field-section" data-inspector-section="task">
      <FieldLabel className="inspector-section-title justify-between" htmlFor={id}>
        <span>{t('workflow.target')}</span>
        <OpenWorkflowLink flowId={target} />
      </FieldLabel>
      <div ref={setContainer} className="node-settings">
        <Combobox.Root
          disabled={disabled || actions.busy}
          value={target || null}
          items={visible.map((item) => item.flowId)}
          filter={null}
          inputValue={open ? query : target ? selectedName : ''}
          onInputValueChange={setQuery}
          onValueChange={(value) => {
            const candidate = choices.find((item) => item.flowId == value)
            if (candidate != null) void actions.select(candidate)
          }}
          open={open}
          onOpenChange={(nextOpen) => {
            setOpen(nextOpen)
            setQuery('')
            if (nextOpen) void readChoices()
          }}
        >
          <ValueEditorFeedback error={open ? undefined : targetError}>
            {(errorId) => (
              <Combobox.InputGroup render={<InputGroup />}>
                {target && (
                  <InputGroupAddon align="inline-start">
                    <i aria-hidden="true" className="i-lucide-light:workflow shrink-0 text-sm" />
                  </InputGroupAddon>
                )}
                <Combobox.Input
                  render={<InputGroupInput />}
                  id={id}
                  aria-label={t('workflow.target')}
                  placeholder={t(open ? 'workflow.search' : 'workflow.select')}
                  aria-invalid={!!targetError || undefined}
                  aria-describedby={errorId}
                  data-field-prompt={!target || undefined}
                />
                <InputGroupAddon align="inline-end">
                  <Tooltip>
                    <TooltipTrigger render={<Combobox.Trigger render={<Button variant="ghost" size="icon-xs" />} aria-label={t('workflow.select')} />}>
                      <SelectChevron />
                    </TooltipTrigger>
                    <TooltipContent container={container}>{t('workflow.select')}</TooltipContent>
                  </Tooltip>
                </InputGroupAddon>
              </Combobox.InputGroup>
            )}
          </ValueEditorFeedback>
          <Combobox.Portal container={container} className="contents">
            <Combobox.Positioner align="start" sideOffset={4} className="isolate z-50">
              <Combobox.Popup
                className={`w-(--anchor-width) min-w-56 max-w-[calc(100vw-24px)] bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none ${selectionMenuContentClass}`}
              >
                <Combobox.List
                  aria-label={t('workflow.target')}
                  className="max-h-[min(50vh,360px,calc(var(--available-height)-0.5rem))] overflow-y-auto overscroll-contain"
                >
                  {(['published', 'missingStart', 'other'] as const).map((group) => {
                    const items = visible.filter((item) => workflowCandidateGroup(item) == group)
                    if (!items.length && group != 'published') return null
                    return (
                      <Combobox.Group key={group} aria-label={t(`workflow.groups.${group}`)}>
                        <WorkflowCandidateGroup
                          group={group}
                          empty={!items.length && !loading && !error ? t(query ? 'workflow.noMatches' : 'workflow.empty') : undefined}
                        >
                          {items.map((item) => (
                            <Combobox.Item key={item.flowId} value={item.flowId} className={workflowCandidateItemClass}>
                              <WorkflowCandidateName item={item} />
                              <Combobox.ItemIndicator>
                                <i aria-hidden="true" className="i-lucide-light:check shrink-0 text-sm" />
                              </Combobox.ItemIndicator>
                            </Combobox.Item>
                          ))}
                        </WorkflowCandidateGroup>
                      </Combobox.Group>
                    )
                  })}
                  {loading && (
                    <p role="status" className="px-2 py-2 text-xs text-muted-foreground">
                      {t('workflow.loading')}
                    </p>
                  )}
                  {error && (
                    <div role="alert" className="flex items-center gap-2 px-2 py-2 text-xs">
                      <span className="min-w-0 flex-1">{error}</span>
                      <Button variant="outline" size="xs" onClick={() => void readChoices()}>
                        {t('workflow.retry')}
                      </Button>
                    </div>
                  )}
                </Combobox.List>
              </Combobox.Popup>
            </Combobox.Positioner>
          </Combobox.Portal>
        </Combobox.Root>
      </div>
    </Field>
  )
}
