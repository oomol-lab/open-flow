import styles from './ErrorNodeContent.module.scss'
import type { ErrorNodeStore } from '../../../stores/node/errorNode.store.ts'

import { useUpdateNodeInternals } from '@xyflow/react'
import { clsx } from 'clsx'
import { memo, useEffect, useMemo } from 'react'
import { useDerived, useVal } from 'use-value-enhancer'
import { arrayShallowEqual } from 'value-enhancer'
import { NODE_HANDLE_CLASSNAME } from '../../../base/designer.ts'
import { useNodeMiniMapPhase } from '../../../components/minimap.tsx'
import { NodeMiniMapPhase } from '../../../stores/designer/nodeMiniMap.ts'
import { parseError } from '../../../stores/node/errorNode.store.ts'

interface ErrorNodeContentProps {
  readonly store: ErrorNodeStore
}

const equalConfig = /*#__PURE__*/ Object.freeze({ equal: arrayShallowEqual })

export const ErrorNodeContent: React.FC<ErrorNodeContentProps> = /*#__PURE__*/ memo(({ store }) => {
  const nodeMiniMapPhase = useNodeMiniMapPhase()
  const rfNode = useVal(store.$.rfNode)
  const iconStyle = useMemo(() => {
    if (nodeMiniMapPhase === NodeMiniMapPhase.Phase2 && rfNode.measured?.height) {
      const h = rfNode.measured.height
      const transform = `translateY(${h / 2 - 16 - 48}px) scale(${h / 2 / 32})`
      return { transform }
    }
  }, [nodeMiniMapPhase, rfNode])

  const [errorMessage, errorStack] = useDerived(store.error$, parseError, equalConfig)
  const messageStyle: React.CSSProperties = useMemo(() => (errorStack ? {} : { textAlign: 'center' }), [errorStack])
  const handles = useVal(store.outputHandles$)

  const update = useUpdateNodeInternals()
  useEffect(() => update(store.rfNodeId), [handles.length])

  return (
    <div className={styles.wrapper}>
      <div className={clsx(NODE_HANDLE_CLASSNAME, styles.icon)} style={iconStyle}>
        <i className="i-carbon:warning" />
      </div>
      <div className={clsx(styles.message, errorStack && styles.monospace)} style={messageStyle}>
        {errorMessage}
      </div>
      {errorStack && <pre className={styles.stack}>{errorStack}</pre>}
      {handles.length > 0 && (
        <div className={`${NODE_HANDLE_CLASSNAME} ${styles.handles}`}>
          {handles.map((handle, i) => (
            <div key={i} className={styles.handle}>
              <div className={styles.handleName}>{handle}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
})
