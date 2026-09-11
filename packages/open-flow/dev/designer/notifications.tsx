import type { FrontendStory, LogAction } from './stories.tsx'

import { useEffect, useId, useRef } from 'react'
import { Toaster, toast } from 'sonner'
import { notificationToasterProps } from '../../src/ui/browser/public.ts'
import { useStoryActions } from './storyActions.tsx'

function NotificationsStory({ dark, log }: { dark: boolean; log: LogAction }) {
  const id = useId()
  const expandedId = useId()
  const sequence = useRef(0)
  const ids = useRef(new Set<string | number>())
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const clear = () => {
    for (const timer of timers.current) clearTimeout(timer)
    timers.current = []
    for (const toastId of ids.current) toast.dismiss(toastId)
    ids.current.clear()
  }
  const show = (kind: 'success' | 'error' | 'action', duration = Infinity, toasterId = id) => {
    sequence.current += 1
    const options = {
      toasterId,
      duration,
      onDismiss: ({ id: toastId }: { id: string | number }) => ids.current.delete(toastId),
      onAutoClose: ({ id: toastId }: { id: string | number }) => ids.current.delete(toastId),
    }
    const toastId =
      kind == 'error'
        ? toast.error('Unable to save changes', {
            ...options,
            description: 'The connection was interrupted. Your edits are still available. Try saving again when the connection returns.',
          })
        : kind == 'action'
          ? toast('Flow archived', { ...options, action: { label: 'Undo', onClick: () => log('undo') } })
          : toast.success(`Changes saved · ${sequence.current}`, options)
    ids.current.add(toastId)
  }
  useEffect(() => {
    sequence.current = 0
    show('error')
    show('action')
    show('success')
    show('success', Infinity, expandedId)
    show('action', Infinity, expandedId)
    show('error', Infinity, expandedId)
    return clear
  }, [id, expandedId])
  useStoryActions([
    { label: 'Add success', onClick: () => show('success') },
    { label: 'Add error', onClick: () => show('error') },
    { label: 'Add action', onClick: () => show('action') },
    {
      label: 'Burst × 3',
      onClick: () => {
        for (let i = 0; i < 3; i += 1) timers.current.push(setTimeout(() => show('success'), i * 450))
      },
    },
    { label: 'Auto dismiss · 4s', onClick: () => show('success', 4000) },
    { label: 'Clear', onClick: clear },
  ])
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 440px), 1fr))', gap: 24, padding: 16 }}>
      {[
        { id, title: 'Interactive stack', expand: false },
        { id: expandedId, title: 'Expanded states', expand: true },
      ].map((sample) => (
        <section key={sample.id} style={{ position: 'relative', minHeight: 440, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 500 }}>{sample.title}</h3>
          <Toaster
            {...notificationToasterProps}
            id={sample.id}
            expand={sample.expand}
            theme={dark ? 'dark' : 'light'}
            containerAriaLabel={sample.title}
            style={{ position: 'absolute' }}
            toastOptions={{ closeButtonAriaLabel: 'Close notification' }}
          />
        </section>
      ))}
    </div>
  )
}

export const notificationsStory: FrontendStory = {
  group: 'Theme Preview',
  id: 'notifications',
  title: 'Notifications',
  description: 'Success, error, long text and actions. Hover or focus to expand the stack; add a burst to inspect entry and displacement.',
  standalone: true,
  render: (log, dark) => <NotificationsStory dark={dark} log={log} />,
}
