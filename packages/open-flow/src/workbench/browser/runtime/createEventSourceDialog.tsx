import type { ComponentProps } from 'react'
import type { EventSource } from '../../../control/common/api.ts'

import { useCallback, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../ui/browser/button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '../../../ui/browser/dialog.tsx'
import { SourceForm } from './eventSources.tsx'
import { EventSourceSetup } from './eventSourceSetup.tsx'
import { errorNotice } from './stores/workbenchNotice.ts'

export function CreateEventSourceDialog({
  client,
  teamId,
  existingNames,
  disabled,
  defaultOpen = false,
  onSelect,
  onCreated,
}: {
  readonly client: ComponentProps<typeof SourceForm>['client']
  readonly teamId: string | null
  readonly existingNames: readonly string[]
  readonly defaultOpen?: boolean
  readonly disabled: boolean
  readonly onCreated: (source: EventSource) => void
  readonly onSelect: (source: EventSource) => Promise<boolean>
}) {
  const t = useTranslate()
  const [open, setOpen] = useState(defaultOpen)
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const portal = useCallback((element: HTMLDivElement | null) => setRoot(element?.closest<HTMLElement>('.open-flow-workbench, .open-flow-theme') ?? null), [])
  const [saving, setSaving] = useState(false)
  const [created, setCreated] = useState<EventSource>()
  const [selected, setSelected] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  async function select(source: EventSource) {
    setPending(true)
    setError(undefined)
    try {
      const saved = await onSelect(source)
      setSelected(saved)
      if (!saved) setError(t('eventSources.bindFailed'))
    } catch (cause) {
      setError(errorNotice(cause, t).message)
    } finally {
      setPending(false)
    }
  }

  return (
    <div ref={portal}>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (saving || pending) return
          setOpen(value)
          if (value) {
            setCreated(undefined)
            setSelected(false)
            setError(undefined)
          }
        }}
      >
        <DialogTrigger disabled={disabled} render={<Button type="button" size="sm" />}>
          {t('eventSources.create')}
        </DialogTrigger>
        <DialogContent container={root} closeLabel={t('contextPanel.close')} className="flex max-h-[85dvh] flex-col overflow-hidden sm:max-w-2xl">
          <DialogTitle className="pr-8">{t(created == null ? 'eventSources.create' : 'eventSources.created')}</DialogTitle>
          <DialogDescription>{t('eventSources.flowCreateHint')}</DialogDescription>
          <div className="min-h-0 overflow-y-auto">
            {open && created == null && (
              <SourceForm
                client={client}
                teams={[]}
                fixedTeamId={teamId}
                onPendingChange={setSaving}
                existingNames={existingNames}
                onCancel={() => setOpen(false)}
                onSaved={(source) => {
                  setCreated(source)
                  onCreated(source)
                  void select(source)
                }}
              />
            )}
            {created != null && (
              <div className="flex flex-col gap-4 py-2">
                <p className="m-0 font-medium">{created.name}</p>
                <EventSourceSetup source={created} client={client} onChange={setCreated} />
                {error != null && (
                  <p role="alert" className="m-0 text-sm text-destructive">
                    {error}
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  {!selected && (
                    <Button disabled={pending || disabled} onClick={() => void select(created)}>
                      {t('eventSources.useSource')}
                    </Button>
                  )}
                  <Button variant={selected ? 'default' : 'outline'} disabled={pending} onClick={() => setOpen(false)}>
                    {t('contextPanel.close')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
