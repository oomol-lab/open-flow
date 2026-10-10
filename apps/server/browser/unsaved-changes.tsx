import type { ReactElement } from 'react'

import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@oomol-lab/open-flow/ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'

export type LeaveGuard = (proceed: () => void) => void

/** Forms own saving; this gate owns confirmation and document-unload protection. */
export function useUnsavedChanges({
  dirty,
  pending,
  save,
  container,
}: {
  readonly dirty: boolean
  readonly pending: boolean
  readonly save: () => Promise<boolean>
  readonly container: HTMLElement | null
}): {
  readonly confirmation: ReactElement
  readonly guard: LeaveGuard
} {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const destination = useRef<(() => void) | undefined>(undefined)
  const guard = useCallback<LeaveGuard>(
    (proceed) => {
      if (pending) return
      if (!dirty) {
        proceed()
        return
      }
      destination.current = proceed
      setOpen(true)
    },
    [dirty, pending],
  )
  useEffect(() => {
    if (!dirty && !pending) return
    const unload = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', unload)
    return () => window.removeEventListener('beforeunload', unload)
  }, [dirty, pending])
  function continueLeaving(): void {
    const next = destination.current
    destination.current = undefined
    setOpen(false)
    next?.()
  }
  return {
    guard,
    confirmation: (
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!pending) setOpen(value)
        }}
      >
        <DialogContent container={container} closeLabel={t('settings.cancel')} showCloseButton={!pending}>
          <DialogHeader>
            <DialogTitle>{t('settings.unsavedTitle')}</DialogTitle>
            <DialogDescription>{t('settings.unsavedDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              {t('settings.cancel')}
            </Button>
            <Button variant="outline" disabled={pending} onClick={continueLeaving}>
              {t('settings.discardChanges')}
            </Button>
            <Button
              disabled={pending}
              onClick={async () => {
                if (await save()) continueLeaving()
                else setOpen(false)
              }}
            >
              {t('settings.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    ),
  }
}
