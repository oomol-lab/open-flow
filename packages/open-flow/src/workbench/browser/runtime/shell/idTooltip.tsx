import type { ComponentProps } from 'react'

import { useTranslate } from 'val-i18n-react'
import { IdTooltip as SharedIdTooltip } from '../../../../ui/browser/idTooltip.tsx'

export function IdTooltip(props: Omit<ComponentProps<typeof SharedIdTooltip>, 'copyLabel' | 'copiedLabel'>) {
  const t = useTranslate()
  return <SharedIdTooltip {...props} copyLabel={t('resource.copyFlowId')} copiedLabel={t('resource.flowIdCopied')} />
}
