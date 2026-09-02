import styles from './NewHandleIndicator.module.scss'
import type { ReactFlowState } from '@xyflow/react'
import type { JSX } from 'react/jsx-runtime'

import { isDefined } from '@wopjs/cast'
import { useStore } from '@xyflow/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { shallow } from 'zustand/shallow'
import { HANDLE_ROW_CLASSNAME } from '../../base/designer.ts'
import { getInsertBefore, getNewHandleIndicator } from './useNewHandleIndicator.ts'

export interface NewHandleIndicatorProps {
  readonly editable: boolean
  readonly zoom?: number
}

const selector = (state: ReactFlowState) => ({
  fromNode: state.connection.fromNode?.id,
  fromPosition: state.connection.fromPosition,
  fromHandle: state.connection.fromHandle?.id,
  toNode: !!state.connection.toNode,
  x: state.connection.to?.x,
  y: state.connection.to?.y,
  inProgress: state.connection.inProgress,
})

export function NewHandleIndicator(props: NewHandleIndicatorProps): JSX.Element {
  const t = useTranslate()
  const ref = useRef<HTMLDivElement>(null)
  const state = useStore(selector, shallow)
  const enable = props.editable && !!(state.inProgress && state.fromNode && state.fromHandle && !state.toNode)

  const [$section, $handleRow, insertBefore] = useMemo((): [Element | null | undefined, Element | null | undefined, boolean | undefined] => {
    if (enable && ref.current && isDefined(state.x) && isDefined(state.y)) {
      const bounds = ref.current.getBoundingClientRect()
      const element = document.elementFromPoint(state.x + bounds.left, state.y + bounds.top)
      const targetSection = element?.closest('[data-section]')
      const targetHandleRow = element?.closest(`.${HANDLE_ROW_CLASSNAME}`)
      return [targetSection, targetHandleRow, getInsertBefore(targetSection, state.y + bounds.top)]
    } else {
      return [null, null, undefined]
    }
  }, [enable, state.x, state.y])

  const indicator = useMemo(
    () => getNewHandleIndicator(state.fromNode, state.fromPosition, state.fromHandle, $section, $handleRow, insertBefore),
    [state.fromNode, state.fromPosition, state.fromHandle, $handleRow, $section, insertBefore],
  )

  const [rect, setRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    if (indicator?.dropZone?.querySelector('[data-drop-or-click]')) {
      return
    }
    setRect(indicator?.dropZone?.getBoundingClientRect() ?? null)
  }, [indicator?.dropZone])

  const zoom = props.zoom ?? 1
  const bounds = ref.current?.getBoundingClientRect() ?? { top: 0, left: 0 }

  return (
    <div ref={ref} className={styles.container}>
      {rect && (
        <div
          className={styles.indicator}
          style={{
            top: rect.top - bounds.top + (indicator?.dropZone === $section && insertBefore ? 58 * zoom : rect.height) - ($handleRow ? 0 : 10 * zoom) + 2 * zoom,
            left: rect.left - bounds.left + ($handleRow ? 0 : 6 * zoom),
            width: rect.width - ($handleRow ? 0 : 12 * zoom),
          }}
        >
          <span className={styles.label}>{t('handleEditor.releaseToConnect')}</span>
        </div>
      )}
    </div>
  )
}
