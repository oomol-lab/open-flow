import type { TFunction } from 'val-i18n'

import { LeinaBotSelect } from './leinaBotSelect.tsx'

export function connectorActionPresentation(actionId: string, t: TFunction) {
  if (actionId != 'leina.send_notification') return undefined
  return {
    name: t('leina.notification'),
    fieldLabels: { leinaId: t('leina.robot'), message: t('leina.message'), subscription: t('leina.subscription') },
    renderInput: ({ handle, ...props }: Parameters<typeof LeinaBotSelect>[0] & { readonly handle: string }) =>
      handle == 'leinaId' ? <LeinaBotSelect key={props.flowId} {...props} /> : undefined,
  }
}
