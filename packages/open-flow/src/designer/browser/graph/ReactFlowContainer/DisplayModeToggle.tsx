import styles from './DisplayModeToggle.module.scss'
import type { Val } from 'value-enhancer'
import type { FlowDisplayMode } from '../../../common/flowDisplay.ts'

import { Panel } from '@xyflow/react'
import { clsx } from 'clsx'
import { memo } from 'react'
import { useVal } from 'use-value-enhancer'
import { useLang, useTranslate } from 'val-i18n-react'
import { isCjkLanguage } from '../../../../localization/common/languages.ts'
import { ToggleGroup, ToggleGroupItem } from '../../../../ui/browser/toggle-group.tsx'

export interface DisplayModeToggleProps {
  displayMode$: Val<FlowDisplayMode>
}

export const DisplayModeToggle: React.FC<DisplayModeToggleProps> = /*#__PURE__*/ memo(function DisplayModeToggle({ displayMode$ }) {
  const t = useTranslate()
  const lang = useLang()
  const displayMode = useVal(displayMode$)

  return (
    <Panel className={styles.container} data-canvas-control-scope position="bottom-center">
      <ToggleGroup<FlowDisplayMode>
        aria-label={t('flowDisplayMode.overviewDescription')}
        className={clsx('bg-background', styles.group, isCjkLanguage(lang) && styles.compact)}
        onValueChange={(values) => {
          const value = values.at(-1)
          if (value != null) displayMode$.set(value)
        }}
        spacing={0}
        size="default"
        value={[displayMode]}
        variant="outline"
      >
        <ToggleGroupItem className={styles.button} title={t('flowDisplayMode.overviewDescription')} value="overview">
          {t('flowDisplayMode.overview')}
        </ToggleGroupItem>
        <ToggleGroupItem className={styles.button} title={t('flowDisplayMode.detailDescription')} value="detail">
          {t('flowDisplayMode.detail')}
        </ToggleGroupItem>
      </ToggleGroup>
    </Panel>
  )
})
