import styles from './BottomRight.module.scss'
import type { Val } from 'value-enhancer'
import type { InteractiveMode } from '../../stores/designer/designer.store.ts'

import { ControlButton, Controls, MiniMap as RFMiniMap } from '@xyflow/react'
import { memo } from 'react'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { setValue } from 'value-enhancer'
import { buttonGroupVariants } from '../../../../ui/browser/button-group.tsx'
import { buttonVariants } from '../../../../ui/browser/button.tsx'
import { cn } from '../../../../ui/browser/utils.ts'
import { iconOf } from '../../jsonSchema/preset.ts'

export interface BottomRightProps {
  miniMapExpanded$?: Val<boolean | undefined>
  interactiveMode$: Val<InteractiveMode>
  showSettings$?: Val<boolean>
}

export const BottomRight: React.FC<BottomRightProps> = /* @__PURE__ */ memo(function (props: BottomRightProps) {
  const t = useTranslate()
  const miniMapExpanded = useVal(props.miniMapExpanded$)
  const showSettings = useVal(props.showSettings$)

  const isMouse = useVal(props.interactiveMode$) === 'mouse'
  const modeBtnTitle = isMouse ? t('interactiveMode.mouse') : t('interactiveMode.touchpad')
  const settingsBtnTitle = t(showSettings ? 'settingsPanel.hide' : 'settingsPanel.show')

  return (
    <>
      {!miniMapExpanded && (
        <Controls
          className={buttonGroupVariants({ orientation: 'horizontal' })}
          orientation="horizontal"
          position="bottom-right"
          showFitView={false}
          showInteractive={false}
          showZoom={false}
        >
          <ControlButton
            aria-label={modeBtnTitle}
            className={buttonVariants({ size: 'icon', variant: 'outline' })}
            data-slot="button"
            onClick={() => props.interactiveMode$.set(isMouse ? 'touchpad' : 'mouse')}
            title={modeBtnTitle}
          >
            {isMouse ? <i className={`${styles.interactionIcon} i-custom:mouse`} /> : <i className={`${styles.interactionIcon} i-custom:touchpad`} />}
          </ControlButton>
          {props.miniMapExpanded$ && (
            <ControlButton
              aria-label={t('miniMap')}
              aria-expanded={false}
              className={buttonVariants({ size: 'icon', variant: 'outline' })}
              data-slot="button"
              onClick={() => props.miniMapExpanded$?.set(true)}
              title={t('miniMap')}
            >
              <i className={`${styles.miniMapIcon} i-custom:minimap`} />
            </ControlButton>
          )}
          {props.showSettings$ && (
            <ControlButton
              aria-label={settingsBtnTitle}
              aria-expanded={showSettings}
              className={buttonVariants({ size: 'icon', variant: 'outline' })}
              data-slot="button"
              onClick={() => setValue(props.showSettings$!, !showSettings)}
              title={settingsBtnTitle}
            >
              <i className={`${styles.settingsIcon} ${iconOf('settings')}`} />
            </ControlButton>
          )}
        </Controls>
      )}
      {props.miniMapExpanded$ && miniMapExpanded && (
        <>
          <RFMiniMap ariaLabel={t('miniMap')} className={styles.miniMap} pannable position="bottom-right" zoomable />
          <Controls
            className={cn(buttonGroupVariants({ orientation: 'horizontal' }), styles.miniMapToggle)}
            orientation="horizontal"
            position="bottom-right"
            showFitView={false}
            showInteractive={false}
            showZoom={false}
          >
            <ControlButton
              aria-label={t('miniMap')}
              aria-expanded
              className={buttonVariants({ size: 'icon', variant: 'outline' })}
              data-slot="button"
              onClick={() => props.miniMapExpanded$?.set(false)}
              title={t('miniMap')}
            >
              <i className={`${styles.miniMapIcon} i-carbon:shrink-screen`} />
            </ControlButton>
          </Controls>
        </>
      )}
    </>
  )
})
