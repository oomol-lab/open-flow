import { dequal } from 'dequal'
import { useCallback, useId, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { ValueEditorFeedback } from '../../../../form/browser/fieldControl.tsx'
import { isHttpHost, maxHttpHosts } from '../../../../http/common/hosts.ts'
import { Button } from '../../../../ui/browser/button.tsx'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '../../../../ui/browser/dialog.tsx'
import { Field, FieldDescription, FieldLabel } from '../../../../ui/browser/field.tsx'
import { Textarea } from '../../../../ui/browser/textarea.tsx'

export function CodeHttpHosts(
  props: { readonly hosts: readonly string[] } & (
    | { readonly readOnly: true }
    | { readonly readOnly?: false; readonly disabled: boolean; readonly onSave: (hosts: readonly string[]) => Promise<boolean> }
  ),
) {
  const { hosts } = props
  const editor = props.readOnly ? undefined : props
  const disabled = editor?.disabled ?? false
  const t = useTranslate()
  const id = useId()
  const saved = hosts.join('\n')
  const [draft, setDraft] = useState(saved)
  const [openedHosts, setOpenedHosts] = useState(saved)
  const [error, setError] = useState<string>()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const portal = useCallback((element: HTMLSpanElement | null) => {
    setContainer(element?.closest<HTMLElement>('.open-flow-workbench') ?? element?.closest<HTMLElement>('.open-flow-theme') ?? null)
  }, [])
  const commit = async () => {
    if (editor == null) return
    if (openedHosts !== saved) {
      setOpenedHosts(saved)
      setDraft(saved)
      setError(t('inspector.task.httpHostsUpdated'))
      return
    }
    const next = [...new Set(draft.split(/[\s,]+/).flatMap((host) => (host == '' ? [] : [host.toLowerCase()])))]
    const invalid = next.find((host) => !isHttpHost(host))
    if (invalid != null) return setError(t('inspector.task.httpHostsInvalid', { host: invalid }))
    if (next.length > maxHttpHosts) return setError(t('inspector.task.httpHostsLimit', { count: maxHttpHosts }))
    setError(undefined)
    setPending(true)
    try {
      if (dequal(next, hosts) || (await editor.onSave(next))) setOpen(false)
    } finally {
      setPending(false)
    }
  }
  return (
    <span className="inline-flex shrink-0" ref={portal}>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (pending) return
          if (next) {
            setOpenedHosts(saved)
            setDraft(saved)
            setError(undefined)
          }
          setOpen(next)
        }}
      >
        <DialogTrigger disabled={disabled} render={<Button type="button" variant="ghost" size="sm" className="font-normal text-muted-foreground" />}>
          {t('inspector.task.httpHosts')}
          {hosts.length > 0 ? ` · ${hosts.length}` : ''}
        </DialogTrigger>
        <DialogContent container={container} closeLabel={t('common.close')}>
          <DialogHeader>
            <DialogTitle>{t('inspector.task.httpHosts')}</DialogTitle>
          </DialogHeader>
          <Field data-inspector-section="code-http">
            <FieldLabel className="sr-only" htmlFor={`${id}-hosts`}>
              {t('inspector.task.httpHosts')}
            </FieldLabel>
            <ValueEditorFeedback error={error}>
              {(errorId) => (
                <Textarea
                  aria-describedby={[editor == null ? undefined : `${id}-hint`, errorId].filter(Boolean).join(' ') || undefined}
                  aria-invalid={error != null || undefined}
                  className="min-h-14 font-mono text-xs"
                  disabled={disabled || pending}
                  id={`${id}-hosts`}
                  onChange={editor == null ? undefined : (event) => setDraft(event.target.value)}
                  placeholder="api.example.com"
                  readOnly={props.readOnly}
                  rows={2}
                  spellCheck={false}
                  value={editor == null ? saved : draft}
                />
              )}
            </ValueEditorFeedback>
            {editor != null && <FieldDescription id={`${id}-hint`}>{t('inspector.task.httpHostsHint')}</FieldDescription>}
          </Field>
          {editor != null && (
            <DialogFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="button" disabled={disabled || pending} onClick={() => void commit()}>
                {t('common.save')}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </span>
  )
}
