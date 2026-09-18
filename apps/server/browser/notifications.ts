import type { WorkbenchNotification } from '@oomol-lab/open-flow/workbench'

import { NotificationUndoLabel } from '@oomol-lab/open-flow/ui'
import { createElement } from 'react'
import { toast } from 'sonner'

const notificationIds = new Set<string | number>()
let undoNotificationId: string | number | undefined

function forget(id: string | number): void {
  notificationIds.delete(id)
  if (undoNotificationId === id) undoNotificationId = undefined
}

export function notify(notification: WorkbenchNotification | undefined): void {
  if (notification == null) {
    for (const id of notificationIds) toast.dismiss(id)
    notificationIds.clear()
    undoNotificationId = undefined
    return
  }
  if (notification.undo != null && undoNotificationId != null) {
    toast.dismiss(undoNotificationId)
    forget(undoNotificationId)
  }
  const options = {
    action:
      notification.undo == null
        ? undefined
        : {
            label: createElement(NotificationUndoLabel, null, notification.undo.label),
            onClick: () => {
              forget(id)
              void notification.undo?.run()
            },
          },
    duration: notification.kind == 'error' ? 8000 : 4000,
    onDismiss: ({ id }: { id: string | number }) => forget(id),
    onAutoClose: ({ id }: { id: string | number }) => forget(id),
  }
  const id: string | number = notification.kind == 'error' ? toast.error(notification.message, options) : toast.success(notification.message, options)
  notificationIds.add(id)
  if (notification.undo != null) undoNotificationId = id
}
