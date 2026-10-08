import type { ReactNode } from 'react'
import type { Flow } from '../api.ts'
import type { WorkspaceStore } from '../stores/workspaceStore.ts'

import { Combobox } from '@base-ui/react/combobox'
import { useEffect, useId, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { selectionMenuContentClass, selectionMenuItemClass } from '../../../../form/browser/selectionMenuStyles.ts'
import { Button } from '../../../../ui/browser/button.tsx'
import { Field, FieldDescription, FieldError, FieldLabel } from '../../../../ui/browser/field.tsx'
import { InputGroup, InputGroupAddon, InputGroupInput } from '../../../../ui/browser/input-group.tsx'
import { SelectChevron } from '../../../../ui/browser/select.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../ui/browser/tooltip.tsx'

export function ErrorTriggerSources({
  flows,
  flowId,
  value,
  disabled = false,
  complete = true,
  footer,
  onChange,
}: {
  readonly flows: readonly Flow[]
  readonly flowId: string
  readonly value: readonly string[]
  readonly complete?: boolean
  readonly disabled?: boolean
  readonly footer?: ReactNode
  readonly onChange: (value: readonly string[]) => void
}) {
  const t = useTranslate()
  const id = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const eligible = flows.filter((flow) => flow.flowId != flowId && flow.status == 'active' && flow.live != null)
  const candidates = [...new Set([...eligible.map((flow) => flow.flowId), ...value])].map((sourceId) => {
    const flow = flows.find((item) => item.flowId == sourceId)
    const issue =
      sourceId == flowId
        ? 'self'
        : flow?.status == 'retiring'
          ? 'retiring'
          : flow == null
            ? complete
              ? 'deleted'
              : undefined
            : flow.live == null
              ? 'unpublished'
              : undefined
    return { id: sourceId, name: flow?.name ?? (issue == 'deleted' ? t('errorWorkflow.deletedName') : sourceId), issue }
  })
  const visible = candidates.filter((flow) => `${flow.name} ${flow.id}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const selected = candidates.filter((flow) => value.includes(flow.id))
  const summary = selected.map((flow) => flow.name).join(', ')
  const unavailable = selected.filter((flow) => flow.issue)
  return (
    <Field className="inspector-field-section">
      <FieldLabel className="inspector-section-title" htmlFor={id}>
        {t('errorWorkflow.sources')}
      </FieldLabel>
      <div className="flex flex-col gap-3">
        <div ref={setContainer} className="min-w-0">
          <Combobox.Root
            multiple
            disabled={disabled}
            value={[...value]}
            onValueChange={onChange}
            items={visible.map((flow) => flow.id)}
            filter={null}
            inputValue={open ? query : summary}
            onInputValueChange={setQuery}
            open={open}
            onOpenChange={(next) => {
              setOpen(next)
              if (!next) setQuery('')
            }}
          >
            <Combobox.InputGroup render={<InputGroup />}>
              <Combobox.Input
                render={<InputGroupInput />}
                id={id}
                aria-label={t('errorWorkflow.sources')}
                aria-describedby={`${id}-hint${unavailable.length > 0 ? ` ${id}-error` : ''}`}
                aria-invalid={unavailable.length > 0 || undefined}
                placeholder={open ? t('errorWorkflow.search') : t('errorWorkflow.choose')}
                title={summary || undefined}
              />
              <InputGroupAddon align="inline-end">
                {value.length > 0 && !disabled && (
                  <Tooltip>
                    <TooltipTrigger render={<Combobox.Clear render={<Button variant="ghost" size="icon-xs" />} aria-label={t('errorWorkflow.clear')} />}>
                      <i aria-hidden="true" className="i-lucide-light:x text-base" />
                    </TooltipTrigger>
                    <TooltipContent container={container}>{t('errorWorkflow.clear')}</TooltipContent>
                  </Tooltip>
                )}
                <Tooltip>
                  <TooltipTrigger render={<Combobox.Trigger render={<Button variant="ghost" size="icon-xs" />} aria-label={t('errorWorkflow.choose')} />}>
                    <SelectChevron />
                  </TooltipTrigger>
                  <TooltipContent container={container}>{t('errorWorkflow.choose')}</TooltipContent>
                </Tooltip>
              </InputGroupAddon>
            </Combobox.InputGroup>
            <Combobox.Portal container={container} className="contents">
              <Combobox.Positioner align="start" sideOffset={4} className="isolate z-50">
                <Combobox.Popup
                  className={`w-(--anchor-width) min-w-56 max-w-[calc(100vw-24px)] bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none ${selectionMenuContentClass}`}
                >
                  <Combobox.List aria-label={t('errorWorkflow.sources')} className="max-h-[min(40vh,280px)] overflow-y-auto overscroll-contain">
                    {visible.map((flow) => (
                      <Combobox.Item
                        key={flow.id}
                        value={flow.id}
                        className={`group/option flex cursor-default items-center gap-2 px-2 data-highlighted:bg-accent ${selectionMenuItemClass}`}
                      >
                        <span
                          aria-hidden="true"
                          className="flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input group-data-selected/option:border-primary group-data-selected/option:bg-primary group-data-selected/option:text-primary-foreground"
                        >
                          <Combobox.ItemIndicator>
                            <i className="i-lucide-light:check block text-sm" />
                          </Combobox.ItemIndicator>
                        </span>
                        <span className="min-w-0 flex-1 break-words">
                          {flow.name}
                          {flow.issue == 'deleted' && <span className="block break-all text-muted-foreground">{flow.id}</span>}
                          {flow.issue && <span className="block text-destructive">{t(`errorWorkflow.${flow.issue}`)}</span>}
                        </span>
                      </Combobox.Item>
                    ))}
                    {visible.length == 0 && (
                      <p className="px-2 py-3 text-xs text-muted-foreground">{t(query ? 'errorWorkflow.noMatches' : 'errorWorkflow.empty')}</p>
                    )}
                  </Combobox.List>
                  {footer}
                </Combobox.Popup>
              </Combobox.Positioner>
            </Combobox.Portal>
          </Combobox.Root>
        </div>
        <FieldDescription id={`${id}-hint`}>{t('errorWorkflow.setupHint')}</FieldDescription>
        {unavailable.length > 0 && (
          <div className="flex flex-col items-start gap-2">
            <FieldError id={`${id}-error`}>
              <ul>
                {unavailable.map((flow) => (
                  <li key={flow.id}>
                    {flow.name} · {t(`errorWorkflow.${flow.issue!}`)}
                  </li>
                ))}
              </ul>
              <p>{t('errorWorkflow.removeHint')}</p>
            </FieldError>
            {!disabled && (
              <Button variant="outline" size="sm" onClick={() => onChange(value.filter((sourceId) => !unavailable.some((flow) => flow.id == sourceId)))}>
                {t('errorWorkflow.removeUnavailable')}
              </Button>
            )}
          </div>
        )}
      </div>
    </Field>
  )
}

export function ErrorTriggerSourcesEditor({
  store,
  nodeId,
  value,
  disabled,
}: {
  readonly store: WorkspaceStore
  readonly nodeId: string
  readonly value: readonly string[]
  readonly disabled: boolean
}) {
  const t = useTranslate()
  const draft = useVal(store.$.draft)
  const flows = useVal(store.$.flows)
  const loading = useVal(store.$.flowLoading)
  const failed = useVal(store.$.flowLoadFailed)
  const more = useVal(store.$.flowNextCursor)
  const loadingMore = useVal(store.$.flowLoadingMore)
  const moreFailed = useVal(store.$.flowLoadMoreFailed)
  useEffect(() => {
    void store.reloadFlows()
  }, [store])
  return (
    <div className="flex flex-col gap-3" aria-busy={loading || loadingMore}>
      <ErrorTriggerSources
        flows={flows}
        flowId={draft?.flowId ?? ''}
        value={value}
        disabled={disabled || loading}
        complete={!loading && !failed && more == null}
        footer={
          <>
            {failed && (
              <Button variant="outline" size="sm" onClick={() => void store.reloadFlows()}>
                {t('errorWorkflow.retry')}
              </Button>
            )}
            {more != null && (
              <Button variant="outline" size="sm" disabled={loadingMore} onClick={() => void store.loadMoreFlows()}>
                {t(moreFailed ? 'errorWorkflow.retry' : 'errorWorkflow.more')}
              </Button>
            )}
          </>
        }
        onChange={(next) => {
          void store.saveErrorSources(nodeId, next)
        }}
      />
    </div>
  )
}
