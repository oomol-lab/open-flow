import type { WorkbenchNotification } from '@oomol-lab/open-flow/workbench'

import { NotificationUndoLabel } from '@oomol-lab/open-flow/ui'
import { createElement } from 'react'
import { toast } from 'sonner'

const notificationIds = new Set<string | number>()

export function notify(notification: WorkbenchNotification | undefined): void {
  if (notification == null) {
    for (const id of notificationIds) toast.dismiss(id)
    notificationIds.clear()
    return
  }
  const options = {
    action:
      notification.undo == null
        ? undefined
        : {
            label: createElement(NotificationUndoLabel, null, notification.undo.label),
            onClick: () => {
              notificationIds.delete(id)
              void notification.undo?.run()
            },
          },
    duration: notification.kind == 'error' ? 8000 : 4000,
    onDismiss: ({ id }: { id: string | number }) => notificationIds.delete(id),
    onAutoClose: ({ id }: { id: string | number }) => notificationIds.delete(id),
  }
  const id: string | number = notification.kind == 'error' ? toast.error(notification.message, options) : toast.success(notification.message, options)
  notificationIds.add(id)
}
