import type { Flow } from '../../../../control/common/api.ts'
import type { TagsContext } from './flowTags.tsx'

import { useId, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { resourceNameIssue, resourceNameMaxLength } from '../../../../flow/common/change.ts'
import { Button } from '../../../../ui/browser/button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../../../ui/browser/dialog.tsx'
import { Field, FieldError, FieldLabel } from '../../../../ui/browser/field.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../ui/browser/tooltip.tsx'
import { TagPicker } from './flowTags.tsx'

export function FlowSettingsDialog({
  flow,
  onClose,
  onSaved,
  finalFocus,
  ...context
}: TagsContext & {
  readonly flow: Flow
  readonly onClose: () => void
  readonly onSaved?: (() => void) | undefined
  readonly finalFocus?: (() => HTMLElement | null) | undefined
}) {
  const t = useTranslate()
  const original = useRef(flow).current
  const [name, setName] = useState(original.name)
  const [ids, setIds] = useState<readonly string[]>(original.tagIds ?? [])
  const [creating, setCreating] = useState(false)
  const [pending, setPending] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const leaveAction = useRef(onClose)
  const continueEditing = useRef<HTMLButtonElement>(null)
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const tags = useVal(context.store.tags.state)
  const titleId = useId()
  const tagsId = useId()
  const issue = resourceNameIssue(name)
  const nameChanged = name.trim() != original.name
  const tagsChanged = JSON.stringify(ids.toSorted()) != JSON.stringify((original.tagIds ?? []).toSorted())
  function requestClose(proceed = onClose): void {
    if (pending || creating) return
    if (nameChanged || tagsChanged) {
      leaveAction.current = proceed
      setConfirmDiscard(true)
    } else proceed()
  }
  async function save(): Promise<void> {
    if (pending || creating || issue != null || (tagsChanged && (tags.loading || tags.failed))) return
    if (!nameChanged && !tagsChanged) {
      onClose()
      return
    }
    setPending(true)
    try {
      if (await context.store.updateFlowSettings(flow.flowId, { ...(nameChanged ? { name: name.trim() } : {}), ...(tagsChanged ? { tagIds: ids } : {}) })) {
        onSaved?.()
        onClose()
      }
    } finally {
      setPending(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) requestClose()
      }}
    >
      <DialogContent ref={setRoot} finalFocus={finalFocus} container={context.container} closeLabel={t('common.cancel')}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('flowSettings.title')}</DialogTitle>
          </DialogHeader>
          <fieldset className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0" disabled={pending}>
            <legend className="sr-only">{t('flowSettings.title')}</legend>
            <Field data-invalid={issue != null}>
              <FieldLabel htmlFor={titleId}>{t('flowSettings.name')}</FieldLabel>
              <Input
                id={titleId}
                autoComplete="off"
                name="flow-title"
                value={name}
                aria-invalid={issue != null}
                aria-describedby={issue != null ? `${titleId}-error` : undefined}
                onChange={(event) => setName(event.target.value)}
              />
              {issue != null && <FieldError id={`${titleId}-error`}>{t(`resource.nameIssue.${issue}`, { max: resourceNameMaxLength })}</FieldError>}
            </Field>
            <Field>
              <FieldLabel htmlFor={tagsId}>{t('tags.title')}</FieldLabel>
              <TagPicker
                {...context}
                onSelectFlow={(target) =>
                  requestClose(() => {
                    onClose()
                    context.onSelectFlow(target)
                  })
                }
                id={tagsId}
                onPendingChange={setCreating}
                dialogContainer={context.container}
                container={root}
                value={ids}
                onChange={setIds}
              />
            </Field>
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending || creating} onClick={() => requestClose()}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={pending || creating || issue != null || (!nameChanged && !tagsChanged) || (tagsChanged && (tags.loading || tags.failed))}
            >
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
        <Dialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
          <DialogContent container={root} initialFocus={continueEditing} showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>{t('flowSettings.discardTitle')}</DialogTitle>
              <DialogDescription>{t('flowSettings.discardDescription')}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button ref={continueEditing} type="button" variant="outline" onClick={() => setConfirmDiscard(false)}>
                {t('flowSettings.continueEditing')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  setConfirmDiscard(false)
                  leaveAction.current()
                }}
              >
                {t('flowSettings.discardChanges')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  )
}

export function FlowSettingsButton({ flow, ...context }: TagsContext & { readonly flow: Flow }) {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const [root, setRoot] = useState<HTMLSpanElement | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  return (
    <span className="inline-flex" ref={setRoot}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              ref={trigger}
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={flow.status != 'active'}
              aria-label={t('flowSettings.title')}
              onClick={() => setOpen(true)}
            />
          }
        >
          <i aria-hidden="true" className="i-lucide-light:settings size-4" />
        </TooltipTrigger>
        <TooltipContent container={root}>{t('flowSettings.title')}</TooltipContent>
      </Tooltip>
      {open && (
        <FlowSettingsDialog
          {...context}
          finalFocus={() => trigger.current}
          container={context.container ?? root?.closest<HTMLElement>('.open-flow-workbench') ?? root}
          flow={flow}
          onClose={() => setOpen(false)}
        />
      )}
    </span>
  )
}
