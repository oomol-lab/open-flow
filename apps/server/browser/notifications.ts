import type { WorkbenchNotification } from '@oomol-lab/open-flow/workbench'

import { toast } from 'sonner'

const notificationIds = new Set<string | number>()

export function notify(notification: WorkbenchNotification | undefined): void {
  if (notification == null) {
    for (const id of notificationIds) toast.dismiss(id)
    notificationIds.clear()
    return
  }
  const options = {
    duration: notification.kind == 'error' ? 8000 : 4000,
    onDismiss: ({ id }: { id: string | number }) => notificationIds.delete(id),
    onAutoClose: ({ id }: { id: string | number }) => notificationIds.delete(id),
  }
  const id = notification.kind == 'error' ? toast.error(notification.message, options) : toast.success(notification.message, options)
  notificationIds.add(id)
}
