import type { FormEvent, ReactElement, ReactNode } from 'react'

import { useEffect, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { resourceNameIssue, resourceNameMaxLength } from '../../../../flow/common/change.ts'
import { Button } from '../../../../ui/browser/button.tsx'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../../../ui/browser/dialog.tsx'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '../../../../ui/browser/field.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { Spinner } from '../../../../ui/browser/spinner.tsx'
import { Icon } from '../icons.tsx'
import { WorkbenchSelect } from './workbenchSelect.tsx'

export default function CreateResourceDialog({
  disabled,
  tagField,
  field,
  id,
  issue,
  label,
  name,
  onNameChange,
  onOpenChange,
  onSubmit,
  pending,
  submitLabel,
  sourceUrl,
  title,
}: {
  readonly tagField?: ((container: HTMLElement | null) => ReactNode) | undefined
  readonly disabled?: boolean | undefined
  readonly field?:
    | {
        readonly ariaLabel: string
        readonly description: string
        readonly label: string
        readonly onValueChange: (value: string) => void
        readonly options: readonly { readonly disabled?: boolean; readonly label: string; readonly value: string }[]
        readonly state: 'ready'
        readonly value: string
      }
    | {
        readonly description: string
        readonly label: string
        readonly state: 'loading'
        readonly status: string
      }
    | {
        readonly description: string
        readonly label: string
        readonly onRetry: () => void
        readonly retry: string
        readonly state: 'error'
        readonly status: string
      }
    | undefined
  readonly id: string
  readonly issue: ReturnType<typeof resourceNameIssue>
  readonly label: string
  readonly name: string
  readonly onNameChange: (name: string) => void
  readonly onOpenChange: (open: boolean) => void
  readonly onSubmit: (event: FormEvent) => void
  readonly sourceUrl?: string | undefined
  readonly submitLabel?: string | undefined
  readonly pending: boolean
  readonly title: string
}): ReactElement {
  const t = useTranslate()
  const input = useRef<HTMLInputElement>(null)
  const portal = useRef<HTMLDivElement>(null)
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const showIssue = name.length > 0 && issue != null
  const message = showIssue ? t(`resource.nameIssue.${issue}`, { max: resourceNameMaxLength }) : t('resource.nameHint', { max: resourceNameMaxLength })
  const messageId = `${id}-message`
  let sourceHref: string | undefined
  if (sourceUrl != null) {
    try {
      const url = new URL(sourceUrl)
      if (url.protocol == 'https:' || url.protocol == 'http:') sourceHref = url.href
    } catch {
      /* Invalid addresses are displayed as text only. */
    }
  }
  const fieldId = `${id}-option`
  useEffect(() => setOpen(true), [])
  return (
    <>
      <div ref={portal} />
      <Dialog
        onOpenChange={setOpen}
        onOpenChangeComplete={(nextOpen) => {
          if (!nextOpen) onOpenChange(false)
        }}
        open={open}
      >
        <DialogContent ref={setRoot} container={portal.current} initialFocus={() => input.current} showCloseButton={false}>
          <form className="flex flex-col gap-4" onSubmit={onSubmit}>
            <DialogHeader>
              <div className="flex items-center justify-between">
                <DialogTitle>{title}</DialogTitle>
                <DialogClose aria-label={t('common.cancel')} render={<Button size="icon-sm" variant="ghost" />} type="button">
                  <Icon name="close" />
                </DialogClose>
              </div>
              {sourceUrl != null && (
                <DialogDescription className="break-all">
                  {sourceHref == null ? (
                    sourceUrl
                  ) : (
                    <a href={sourceHref} target="_blank" rel="noreferrer">
                      {sourceUrl}
                    </a>
                  )}
                </DialogDescription>
              )}
            </DialogHeader>
            <FieldGroup className="gap-4">
              <Field data-invalid={showIssue}>
                <FieldLabel htmlFor={id}>{label}</FieldLabel>
                <Input
                  autoComplete="off"
                  aria-describedby={messageId}
                  aria-invalid={showIssue}
                  id={id}
                  name="resource-name"
                  onChange={(event) => onNameChange(event.target.value)}
                  ref={input}
                  required
                  value={name}
                />
                {showIssue ? <FieldError id={messageId}>{message}</FieldError> : <FieldDescription id={messageId}>{message}</FieldDescription>}
              </Field>
              {tagField?.(root)}
              {field != null && (
                <Field>
                  <FieldLabel htmlFor={field.state == 'ready' ? fieldId : undefined}>{field.label}</FieldLabel>
                  {field.state == 'ready' ? (
                    <WorkbenchSelect
                      ariaLabel={field.ariaLabel}
                      className="w-full"
                      id={fieldId}
                      onValueChange={field.onValueChange}
                      options={field.options}
                      portalRoot={root}
                      value={field.value}
                    />
                  ) : (
                    <div
                      className="flex min-h-9 items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm text-muted-foreground"
                      role={field.state == 'error' ? 'alert' : 'status'}
                    >
                      {field.state == 'loading' && <Spinner aria-hidden="true" />}
                      <span>{field.status}</span>
                      {field.state == 'error' && (
                        <Button className="ml-auto bg-background" onClick={field.onRetry} size="sm" type="button" variant="outline">
                          {field.retry}
                        </Button>
                      )}
                    </div>
                  )}
                  <FieldDescription>{field.description}</FieldDescription>
                </Field>
              )}
            </FieldGroup>
            <DialogFooter className="mx-0 mb-0 border-0 bg-transparent p-0 pt-1">
              <DialogClose render={<Button variant="outline" />} type="button">
                {t('common.cancel')}
              </DialogClose>
              <Button disabled={disabled || pending || issue != null} type="submit">
                {pending ? t('common.creating') : (submitLabel ?? t('common.create'))}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
